import { buildLedger, type Ledger } from './ledger';
import { uid } from './format';
import type { AnyEnvelope, EventType, Payloads } from './types';

/**
 * Локальное хранилище (IndexedDB) + синхронизация с сервером.
 * Работает одинаково в браузере, в приложении для Windows и для Mac.
 * Операции сначала пишутся локально (касса работает без интернета),
 * затем отправляются на сервер; с сервера приходят операции других устройств.
 */

export interface Settings {
  serverUrl: string; // '' — тот же адрес, с которого открыта веб-версия
  token: string;
  device: string;
  shopName: string;
  onboarded: boolean;
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'ok' | 'offline' | 'auth' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastOk?: string;
  pending: number;
  error?: string;
}

export interface Snapshot {
  ready: boolean;
  ledger: Ledger;
  settings: Settings;
  sync: SyncState;
}

type Stored = AnyEnvelope & { _pending?: 1 };

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const DB_NAME = 'gryadka';
const DB_VER = 1;

function defaultSettings(): Settings {
  return {
    serverUrl: '',
    token: '',
    device: isTauri ? 'Каса' : 'Браузер',
    shopName: 'Мій магазин',
    onboarded: false,
  };
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

class Store {
  private db!: IDBDatabase;
  private events = new Map<string, Stored>();
  private cursor = 0;
  private listeners = new Set<() => void>();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private resync = false;
  snap: Snapshot = {
    ready: false,
    ledger: buildLedger([]),
    settings: defaultSettings(),
    sync: { status: 'off', pending: 0 },
  };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  private emit(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  async init() {
    this.db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = this.db.transaction(['events', 'meta'], 'readonly');
    const all = (await req(tx.objectStore('events').getAll())) as Stored[];
    const settings = (await req(tx.objectStore('meta').get('settings'))) as Settings | undefined;
    const cursor = (await req(tx.objectStore('meta').get('cursor'))) as number | undefined;
    for (const e of all) this.events.set(e.id, e);
    this.cursor = cursor || 0;
    const s = { ...defaultSettings(), ...(settings || {}) };
    if (!isTauri && !settings) {
      // веб-версия на сервере: ключ можно передать ссылкой …/#key=XXXX
      const m = location.hash.match(/key=([^&]+)/);
      if (m) {
        s.token = decodeURIComponent(m[1]);
        history.replaceState(null, '', location.pathname);
      }
    }
    this.emit({ ready: true, settings: s });
    this.rebuild();
    if (persistAvailable()) navigator.storage.persist().catch(() => {});
    window.addEventListener('online', () => this.scheduleSync(100));
    setInterval(() => this.scheduleSync(0), 10_000);
    this.scheduleSync(50);
  }

  private rebuild() {
    const list = [...this.events.values()];
    const pending = list.filter((e) => e._pending).length;
    this.emit({
      ledger: buildLedger(list),
      sync: { ...this.snap.sync, pending, status: this.syncEnabled() ? this.snap.sync.status : 'off' },
    });
  }

  syncEnabled() {
    const s = this.snap.settings;
    return !!s.token && (!!s.serverUrl || !isTauri);
  }

  /** Записать новую операцию */
  async add<T extends EventType>(type: T, p: Payloads[T], ts?: string): Promise<string> {
    const e = { id: uid(), type, ts: ts || new Date().toISOString(), device: this.snap.settings.device, p, _pending: 1 } as Stored;
    const tx = this.db.transaction('events', 'readwrite');
    tx.objectStore('events').put(e);
    await txDone(tx);
    this.events.set(e.id, e);
    this.rebuild();
    this.scheduleSync(300);
    return e.id;
  }

  async addMany(list: { type: EventType; p: Payloads[EventType]; ts?: string }[]) {
    const tx = this.db.transaction('events', 'readwrite');
    const os = tx.objectStore('events');
    const created: Stored[] = list.map(
      (x) => ({ id: uid(), type: x.type, ts: x.ts || new Date().toISOString(), device: this.snap.settings.device, p: x.p, _pending: 1 }) as Stored,
    );
    created.forEach((e) => os.put(e));
    await txDone(tx);
    created.forEach((e) => this.events.set(e.id, e));
    this.rebuild();
    this.scheduleSync(300);
  }

  /** Принять операции из резервной копии или с сервера */
  async merge(list: AnyEnvelope[], opts: { pending: boolean }) {
    const fresh = list.filter((e) => e && e.id && e.type && e.ts && !this.events.has(e.id));
    if (!fresh.length) return 0;
    const tx = this.db.transaction('events', 'readwrite');
    const os = tx.objectStore('events');
    for (const e of fresh) {
      const rec: Stored = { id: e.id, type: e.type, ts: e.ts, device: e.device, p: e.p } as Stored;
      if (opts.pending) rec._pending = 1;
      os.put(rec);
      this.events.set(rec.id, rec);
    }
    await txDone(tx);
    this.rebuild();
    if (opts.pending) this.scheduleSync(300);
    return fresh.length;
  }

  allEvents(): AnyEnvelope[] {
    return [...this.events.values()].map(({ _pending, ...e }) => e as AnyEnvelope);
  }

  async saveSettings(patch: Partial<Settings>) {
    const prev = this.snap.settings;
    const settings = { ...prev, ...patch };
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(settings, 'settings');
    const serverChanged = settings.serverUrl !== prev.serverUrl || settings.token !== prev.token;
    if (serverChanged) {
      // другой сервер — забираем всё заново и отправляем всё своё
      this.cursor = 0;
      tx.objectStore('meta').put(0, 'cursor');
    }
    await txDone(tx);
    if (serverChanged) await this.markAllPending();
    this.emit({ settings, sync: { ...this.snap.sync, status: 'idle', error: undefined } });
    this.rebuild();
    this.scheduleSync(50);
  }

  private async markAllPending() {
    const tx = this.db.transaction('events', 'readwrite');
    const os = tx.objectStore('events');
    for (const e of this.events.values()) {
      e._pending = 1;
      os.put(e);
    }
    await txDone(tx);
  }

  async wipeLocal() {
    const tx = this.db.transaction(['events', 'meta'], 'readwrite');
    tx.objectStore('events').clear();
    tx.objectStore('meta').put(0, 'cursor');
    await txDone(tx);
    this.events.clear();
    this.cursor = 0;
    this.rebuild();
    this.scheduleSync(50);
  }

  /* ---------- синхронизация ---------- */

  scheduleSync(delay: number) {
    if (!this.syncEnabled()) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.syncNow();
    }, delay);
  }

  private apiBase() {
    const u = this.snap.settings.serverUrl.trim().replace(/\/+$/, '');
    return u ? (/^https?:\/\//.test(u) ? u : `https://${u}`) : '';
  }

  async testConnection(serverUrl: string, token: string): Promise<{ ok: boolean; shop?: string; error?: string }> {
    const base = serverUrl.trim().replace(/\/+$/, '');
    const url = (base ? (/^https?:\/\//.test(base) ? base : `https://${base}`) : '') + '/api/hello';
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 401) return { ok: false, error: 'Невірний ключ магазину' };
      if (!r.ok) return { ok: false, error: `Сервер відповів помилкою ${r.status}` };
      const j = await r.json();
      return { ok: true, shop: j.shop };
    } catch {
      return { ok: false, error: 'Сервер недоступний — перевірте адресу та інтернет' };
    }
  }

  async syncNow() {
    if (!this.syncEnabled()) return;
    if (this.syncing) {
      this.resync = true;
      return;
    }
    this.syncing = true;
    this.emit({ sync: { ...this.snap.sync, status: 'syncing' } });
    try {
      for (let guard = 0; guard < 200; guard++) {
        const pending = [...this.events.values()].filter((e) => e._pending).slice(0, 500);
        const body = { cursor: this.cursor, events: pending.map(({ _pending, ...e }) => e) };
        const r = await fetch(this.apiBase() + '/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.snap.settings.token}` },
          body: JSON.stringify(body),
        });
        if (r.status === 401) {
          this.emit({ sync: { ...this.snap.sync, status: 'auth', error: 'Невірний ключ магазину' } });
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { events: AnyEnvelope[]; cursor: number; more: boolean; shop?: string };
        // записываем: пришедшие события, снятие флага pending, курсор
        const tx = this.db.transaction(['events', 'meta'], 'readwrite');
        const os = tx.objectStore('events');
        let changed = false;
        for (const e of pending) {
          const cur = this.events.get(e.id);
          if (cur) {
            delete cur._pending;
            os.put(cur);
          }
        }
        for (const e of j.events) {
          if (!this.events.has(e.id)) {
            const rec = { id: e.id, type: e.type, ts: e.ts, device: e.device, p: e.p } as Stored;
            this.events.set(e.id, rec);
            os.put(rec);
            changed = true;
          }
        }
        this.cursor = j.cursor;
        tx.objectStore('meta').put(j.cursor, 'cursor');
        await txDone(tx);
        if (changed || pending.length) this.rebuild();
        const left = [...this.events.values()].some((e) => e._pending);
        if (!j.more && !left) break;
      }
      this.emit({ sync: { ...this.snap.sync, status: 'ok', lastOk: new Date().toISOString(), error: undefined } });
    } catch (err) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      this.emit({
        sync: { ...this.snap.sync, status: offline ? 'offline' : 'error', error: offline ? 'Немає інтернету' : 'Сервер недоступний' },
      });
    } finally {
      this.syncing = false;
      if (this.resync) {
        this.resync = false;
        this.scheduleSync(200);
      }
    }
  }
}

function persistAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.persist === 'function';
}

export const store = new Store();
