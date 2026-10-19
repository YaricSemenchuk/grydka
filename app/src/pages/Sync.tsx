import { useMemo, useState } from 'react';
import { fmtDateTime } from '../core/format';
import { isTauri, store } from '../core/store';
import type { AnyEnvelope } from '../core/types';
import { pickFile, saveFile, todayStamp } from '../platform';
import { Confirm, useStore, useToast } from '../ui';

export const STATUS_TEXT: Record<string, [string, string]> = {
  off: ['Без сервера', '#8FA197'],
  idle: ['Підключення…', '#D9C46A'],
  syncing: ['Синхронізація…', '#D9C46A'],
  ok: ['Синхронізовано', '#6FD08A'],
  offline: ['Немає інтернету', '#E6A657'],
  auth: ['Невірний ключ', '#E5786B'],
  error: ['Сервер недоступний', '#E6A657'],
};

export function Sync() {
  const { ledger, settings, sync } = useStore();
  const toast = useToast();
  const [url, setUrl] = useState(settings.serverUrl);
  const [token, setToken] = useState(settings.token);
  const [device, setDevice] = useState(settings.device);
  const [shop, setShop] = useState(settings.shopName);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [wipe, setWipe] = useState(false);
  const dirty = url !== settings.serverUrl || token !== settings.token || device !== settings.device || shop !== settings.shopName;

  const origin = isTauri ? url.trim().replace(/\/+$/, '') : location.origin;
  const ownerLink = origin && token ? `${/^https?:\/\//.test(origin) ? origin : `https://${origin}`}/#key=${encodeURIComponent(token)}` : '';

  const devices = useMemo(() => {
    const m = new Map<string, { name: string; count: number; last: string }>();
    for (const o of ledger.ops) {
      const d = m.get(o.device) || { name: o.device, count: 0, last: o.ts };
      d.count++;
      if (o.ts > d.last) d.last = o.ts;
      m.set(o.device, d);
    }
    return [...m.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
  }, [ledger]);

  async function test() {
    setTesting(true);
    const r = await store.testConnection(isTauri ? url : '', token);
    setTesting(false);
    if (r.ok) toast(`З’єднання є${r.shop ? ` · ${r.shop}` : ''}`);
    else toast(r.error || 'Помилка', 'err');
    return r;
  }

  async function save() {
    await store.saveSettings({ serverUrl: isTauri ? url.trim() : '', token: token.trim(), device: device.trim() || 'Пристрій', shopName: shop.trim() || 'Мій магазин' });
    toast('Налаштування збережено');
  }

  async function backup() {
    const data = JSON.stringify({ app: 'gryadka', exportedAt: new Date().toISOString(), shop: settings.shopName, events: store.allEvents() });
    const ok = await saveFile(`gryadka-kopiya-${todayStamp()}.json`, data, 'application/json');
    if (ok) toast('Резервну копію збережено');
  }

  async function restore() {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const j = JSON.parse(new TextDecoder().decode(f.bytes));
      if (!Array.isArray(j.events)) throw new Error();
      const n = await store.merge(j.events as AnyEnvelope[], { pending: true });
      toast(n ? `Відновлено операцій: ${n}` : 'Усі операції з копії вже є');
    } catch {
      toast('Це не файл резервної копії «Грядки»', 'err');
    }
  }

  const [label, color] = STATUS_TEXT[sync.status] || STATUS_TEXT.off;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Синхронізація та пристрої</h1>
          <div className="sub">Каса в магазині, Mac власника й веб-версія бачать ті самі дані</div>
        </div>
      </div>

      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
        <form
          className="card"
          style={{ flex: '999 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 18 }}>Сервер магазину</h2>
            <span className="tag" style={{ background: '#F1F4F0', color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999 }}>
              <span className="dot" style={{ background: color }} />
              {label}
            </span>
          </div>
          <div className="form-grid">
            {isTauri ? (
              <label className="field">
                Адреса сервера
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://облік.ваш-домен.ua" autoComplete="off" />
              </label>
            ) : (
              <div className="field">
                Адреса сервера
                <input value={location.origin} readOnly aria-label="Адреса сервера" />
              </div>
            )}
            <label className="field">
              Ключ магазину
              <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                <input type={show ? 'text' : 'password'} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
                <button type="button" className="btn small" onClick={() => setShow(!show)}>
                  {show ? 'Сховати' : 'Показати'}
                </button>
              </div>
            </label>
            <label className="field">
              Назва цього пристрою
              <input value={device} onChange={(e) => setDevice(e.target.value)} placeholder="Каса" />
            </label>
            <label className="field">
              Назва магазину
              <input value={shop} onChange={(e) => setShop(e.target.value)} />
            </label>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={test} disabled={testing || !token}>
              {testing ? 'Перевіряю…' : 'Перевірити з’єднання'}
            </button>
            {ownerLink && (
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  await navigator.clipboard.writeText(ownerLink).catch(() => {});
                  toast('Посилання скопійовано. Надсилайте лише тим, кому довіряєте — воно містить ключ');
                }}
              >
                Скопіювати посилання для власника
              </button>
            )}
            <button type="submit" className="btn primary" disabled={!dirty}>
              Зберегти
            </button>
            <button type="button" className="btn" disabled={!store.syncEnabled()} onClick={() => store.syncNow()}>
              Синхронізувати зараз
            </button>
          </div>
          <div className="form-grid">
            <div className="card" style={{ background: '#F6F8F5', border: 0, padding: '12px 14px' }}>
              <div className="hint" style={{ fontSize: 12 }}>
                Остання синхронізація
              </div>
              <div className="num" style={{ fontSize: 17, fontWeight: 600 }}>
                {sync.lastOk ? fmtDateTime(sync.lastOk) : '—'}
              </div>
            </div>
            <div className="card" style={{ background: '#F6F8F5', border: 0, padding: '12px 14px' }}>
              <div className="hint" style={{ fontSize: 12 }}>
                Очікують відправки
              </div>
              <div className="num" style={{ fontSize: 17, fontWeight: 600 }}>
                {sync.pending}
              </div>
            </div>
            <div className="card" style={{ background: '#F6F8F5', border: 0, padding: '12px 14px' }}>
              <div className="hint" style={{ fontSize: 12 }}>
                Записів на пристрої
              </div>
              <div className="num" style={{ fontSize: 17, fontWeight: 600 }}>
                {ledger.eventCount}
              </div>
            </div>
          </div>
          {sync.error && sync.status !== 'ok' && <div className="warn">{sync.error}</div>}
        </form>

        <div className="card" style={{ flex: '1 1 300px', background: 'var(--side)', borderColor: 'var(--side)', color: '#fff', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ fontSize: 17 }}>Немає інтернету чи світла?</h2>
          <div style={{ color: '#C9D6CD', lineHeight: 1.55 }}>
            Каса продовжує працювати: продажі зберігаються на комп’ютері й самі відправляться на сервер, щойно з’явиться зв’язок. Нічого не губиться і не дублюється.
          </div>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Пристрої магазину</h2>
        {devices.length ? (
          <div className="form-grid">
            {devices.map((d) => (
              <div key={d.name} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {d.name}
                  {d.name === settings.device ? <span className="muted" style={{ fontWeight: 400 }}> · цей пристрій</span> : null}
                </div>
                <div className="hint" style={{ fontSize: 13, marginTop: 4 }}>
                  Операцій: {d.count} · остання {fmtDateTime(d.last)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="hint">Ще немає операцій</div>
        )}
      </section>

      <section className="grid-2">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>Резервні копії</h2>
          <div className="hint" style={{ lineHeight: 1.55 }}>
            Сервер щодня робить копію бази й зберігає 30 останніх. Додатково можна зберегти копію собі — у файл.
          </div>
          <div className="row">
            <button className="btn" onClick={backup}>
              Зберегти копію у файл
            </button>
            <button className="btn" onClick={restore}>
              Відновити з копії
            </button>
          </div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>Як відкрити на Mac або телефоні</h2>
          <div className="hint" style={{ lineHeight: 1.55 }}>
            Встановіть застосунок для macOS або просто відкрийте адресу сервера в браузері й введіть ключ магазину — побачите ті самі дані й звіти.
          </div>
          <button className="btn danger small" style={{ alignSelf: 'flex-start', marginTop: 'auto' }} onClick={() => setWipe(true)}>
            Очистити дані на цьому пристрої
          </button>
        </div>
      </section>

      {wipe && (
        <Confirm
          title="Очистити дані на цьому пристрої?"
          text={
            sync.pending > 0 ? (
              <span className="warn">
                Увага: {sync.pending} операцій ще не відправлено на сервер — вони пропадуть. Спершу дочекайтеся синхронізації або збережіть копію у файл.
              </span>
            ) : (
              'Дані на сервері не зміняться. Після очищення пристрій заново завантажить усе із сервера.'
            )
          }
          ok="Очистити"
          danger
          onClose={() => setWipe(false)}
          onOk={async () => {
            await store.wipeLocal();
            toast('Локальні дані очищено');
          }}
        />
      )}
    </>
  );
}
