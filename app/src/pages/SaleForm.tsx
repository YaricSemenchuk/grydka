import { useEffect, useMemo, useRef, useState } from 'react';
import { avgCost, matchProduct, type ProductState } from '../core/ledger';
import { lineTotal, money, moneyInput, parseMoney, parseQty, qty } from '../core/format';
import { store } from '../core/store';
import type { Pay } from '../core/types';
import { useStore, useToast } from '../ui';
import { beep, claimScan } from '../scanner';
import type { Scan } from '../App';
import { ProductModal } from './Products';

interface CartLine {
  pid: string;
  qty: string;
  price: string;
}

export function SaleForm({ focusNonce, scan }: { focusNonce: number; scan: Scan | null }) {
  const { ledger } = useStore();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState('');
  const [pay, setPay] = useState<Pay>('cash');
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // скан штрихкоду: знайшли — додаємо в чек (повторний скан = +1), ні — пропонуємо створити товар
  useEffect(() => {
    if (!scan || !claimScan(scan.n)) return;
    const p = store.getSnapshot().ledger.productList.find((x) => x.barcode === scan.code);
    if (p) {
      addProduct(p);
      setUnknown(null);
      setFlash(p.pid);
      beep(true);
    } else {
      setUnknown(scan.code);
      beep(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan?.n]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    searchRef.current?.focus();
  }, [focusNonce]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const exact = ledger.productList.filter((p) => (p.barcode && p.barcode === q.trim()) || (p.sku && p.sku.toLowerCase() === s));
    if (exact.length) return exact;
    return ledger.productList.filter((p) => matchProduct(p, s)).slice(0, 7);
  }, [q, ledger]);

  function addProduct(p: ProductState) {
    setCart((c) => {
      const i = c.findIndex((l) => l.pid === p.pid);
      if (i >= 0) {
        const next = [...c];
        const cur = parseQty(next[i].qty) || 0;
        next[i] = { ...next[i], qty: String((cur + 1000) / 1000).replace('.', ',') };
        return next;
      }
      return [...c, { pid: p.pid, qty: '1', price: moneyInput(p.sell) }];
    });
    setQ('');
    setSel(0);
    searchRef.current?.focus();
  }

  const lines = cart.map((l) => {
    const p = ledger.products.get(l.pid)!;
    const qm = parseQty(l.qty);
    const pr = parseMoney(l.price);
    const ok = qm !== null && qm > 0 && pr !== null && pr > 0;
    const total = ok ? lineTotal(qm!, pr!) : 0;
    const cost = ok ? Math.round((avgCost(p) * qm!) / 1000) : 0;
    return { ...l, p, qm: qm || 0, pr: pr || 0, ok, total, cost, short: ok && p.stock < qm! };
  });
  const gross = lines.reduce((s, l) => s + l.total, 0);
  const disc = Math.min(Math.max(0, parseMoney(discount) || 0), gross);
  const toPay = gross - disc;
  const cost = lines.reduce((s, l) => s + l.cost, 0);
  const valid = lines.length > 0 && lines.every((l) => l.ok);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await store.add('sale', { items: lines.map((l) => ({ pid: l.pid, qty: l.qm, price: l.pr })), pay, discount: disc || undefined });
      toast(`Продаж проведено: ${money(toPay)}`);
      setCart([]);
      setDiscount('');
      setPay('cash');
      searchRef.current?.focus();
    } catch {
      toast('Не вдалося зберегти продаж', 'err');
    } finally {
      setBusy(false);
    }
  }

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[sel]) addProduct(matches[sel]);
      else if (!q.trim()) submit();
    } else if (e.key === 'Escape') {
      setQ('');
    }
  }

  const upd = (i: number, patch: Partial<CartLine>) => setCart((c) => c.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <section className="salebox" aria-label="Новий продаж">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Новий продаж</h2>
        <span className="num muted" style={{ fontSize: 12, border: '1px solid #d6ddd5', borderRadius: 6, padding: '2px 6px' }}>
          F2
        </span>
      </div>
      <label className="field">
        Товар або штрихкод
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={onSearchKey}
          placeholder="Почніть вводити назву…"
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls="sale-suggest"
          autoComplete="off"
        />
      </label>
      {q.trim() && (
        <div className="suggest" id="sale-suggest" role="listbox">
          {matches.length ? (
            matches.map((p, i) => (
              <button key={p.pid} role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => addProduct(p)}>
                <span>{p.name}</span>
                <span className="num muted">
                  {money(p.sell)} · {qty(p.stock)} {p.unit}
                </span>
              </button>
            ))
          ) : (
            <div className="empty" style={{ padding: 14 }}>
              Нічого не знайдено
            </div>
          )}
        </div>
      )}

      {unknown && (
        <div className="alert" style={{ padding: '10px 14px' }} role="alert">
          <div style={{ fontSize: 14 }}>
            Штрихкод <b className="num">{unknown}</b> не знайдено в каталозі
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={() => setCreating(unknown)}>
              Створити товар
            </button>
            <button className="btn small" onClick={() => setUnknown(null)}>
              Закрити
            </button>
          </div>
        </div>
      )}
      {creating && (
        <ProductModal
          product={null}
          initialBarcode={creating}
          onClose={() => setCreating(null)}
          onSaved={(pid) => {
            const p = store.getSnapshot().ledger.products.get(pid);
            if (p) addProduct(p);
            setUnknown(null);
          }}
        />
      )}

      {lines.length > 0 ? (
        <div className="cart">
          {lines.map((l, i) => (
            <div key={l.pid} className={`cart-item${flash === l.pid ? ' flash' : ''}`}>
              <div className="cart-line">
                <span className="name" title={l.p.name}>
                  {l.p.name}
                </span>
                <input aria-label={`Кількість: ${l.p.name}`} value={l.qty} inputMode="decimal" onChange={(e) => upd(i, { qty: e.target.value })} onFocus={(e) => e.target.select()} onKeyDown={(e) => e.key === 'Enter' && submit()} />
                <input aria-label={`Ціна: ${l.p.name}`} value={l.price} inputMode="decimal" onChange={(e) => upd(i, { price: e.target.value })} onFocus={(e) => e.target.select()} onKeyDown={(e) => e.key === 'Enter' && submit()} />
                <span className="num" style={{ textAlign: 'right' }}>
                  {money(l.total)}
                </span>
                <button className="x" aria-label={`Прибрати ${l.p.name}`} onClick={() => setCart((c) => c.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
              {!l.ok && <div className="warn" style={{ fontSize: 12 }}>{l.pr === 0 && l.p.sell === 0 ? 'У товару немає ціни продажу — вкажіть ціну' : 'Перевірте кількість і ціну'}</div>}
              {l.short && (
                <div className="warn" style={{ fontSize: 12 }}>
                  На складі лише {qty(l.p.stock)} {l.p.unit} — залишок піде в мінус
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="hint" style={{ fontSize: 13 }}>
          Відскануйте штрихкод — товар одразу додасться в чек (повторний скан — ще +1 шт). Або знайдіть за назвою: Enter — додати, ↑↓ — вибір.
        </div>
      )}

      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 1 }}>
          Знижка, грн
          <input value={discount} inputMode="decimal" onChange={(e) => setDiscount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="0" />
        </label>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
          Оплата
        </legend>
        <div className="pay">
          <label>
            <input type="radio" name="pay" checked={pay === 'cash'} onChange={() => setPay('cash')} /> Готівка
          </label>
          <label>
            <input type="radio" name="pay" checked={pay === 'card'} onChange={() => setPay('card')} /> Картка
          </label>
        </div>
      </fieldset>

      <div className="totals">
        <div>
          <span className="muted">Собівартість</span>
          <span className="num">{money(cost)}</span>
        </div>
        <div>
          <span className="muted">Прибуток із чека</span>
          <span className={`num ${toPay - cost >= 0 ? 'good' : 'warn'}`} style={{ fontWeight: 600 }}>
            {money(toPay - cost, { sign: true })}
          </span>
        </div>
        <div className="grand">
          <span>До сплати</span>
          <span className="num">{money(toPay)}</span>
        </div>
      </div>

      <button className="btn primary big" disabled={!valid || busy} onClick={submit}>
        Провести продаж · Enter
      </button>
      <div className="hint" style={{ fontSize: 12, textAlign: 'center' }}>
        Залишки на складі спишуться автоматично
      </div>
    </section>
  );
}
