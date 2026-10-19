import { useMemo, useState } from 'react';
import { avgCost, productPayload, type ProductState } from '../core/ledger';
import { money, parseNum } from '../core/format';
import { store } from '../core/store';
import { Modal, useStore, useToast } from '../ui';

type Scope = 'noprice' | 'ids' | 'category' | 'all';
type Rounding = '1' | '0.5' | '9' | 'none';

/** Ціна продажу від собівартості: націнка % + округлення вгору */
export function priceWithMarkup(cost: number, pct: number, rounding: Rounding): number {
  const raw = cost * (1 + pct / 100);
  switch (rounding) {
    case '1':
      return Math.ceil(raw / 100) * 100;
    case '0.5':
      return Math.ceil(raw / 50) * 50;
    case '9': {
      // психологічна ціна …9 грн (49, 89, 129) — лише якщо це додає не більше 10% до розрахункової,
      // інакше дешевий товар здорожчав би непропорційно (7,50 → 19 грн); тоді — до цілої гривні
      const uah = Math.ceil(raw / 100);
      const nine = Math.floor(uah / 10) * 10 + 9;
      return (nine * 100 <= raw * 1.1 ? nine : uah) * 100;
    }
    default:
      return Math.round(raw);
  }
}

export function MarkupModal({ onClose, ids, title }: { onClose: () => void; ids?: string[]; title?: string }) {
  const { ledger } = useStore();
  const toast = useToast();
  const noPrice = ledger.productList.filter((p) => !p.sell);
  const [scope, setScope] = useState<Scope>(ids?.length ? 'ids' : noPrice.length ? 'noprice' : 'all');
  const [cat, setCat] = useState(ledger.categories[0] || '');
  const [pct, setPct] = useState('50');
  const [rounding, setRounding] = useState<Rounding>('1');
  const [catPct, setCatPct] = useState<Record<string, string>>({});
  const [byCat, setByCat] = useState(false);

  const targets: ProductState[] = useMemo(() => {
    const list = ledger.productList;
    switch (scope) {
      case 'noprice':
        return list.filter((p) => !p.sell);
      case 'ids': {
        const set = new Set(ids);
        return list.filter((p) => set.has(p.pid));
      }
      case 'category':
        return list.filter((p) => p.category === cat);
      default:
        return list;
    }
  }, [ledger, scope, cat, ids]);

  const cats = [...new Set(targets.map((p) => p.category))];
  const pctFor = (p: ProductState) => parseNum(byCat ? (catPct[p.category] ?? pct) : pct);
  const rows = targets.map((p) => {
    const cost = Math.round(avgCost(p));
    const m = pctFor(p);
    const next = cost > 0 && m !== null && m >= 0 ? priceWithMarkup(cost, m, rounding) : null;
    return { p, cost, next };
  });
  const valid = rows.filter((r) => r.next !== null && r.next !== r.p.sell);
  const noCost = rows.filter((r) => !r.cost).length;
  const m = parseNum(pct);

  async function apply() {
    if (!valid.length) return;
    await store.addMany(valid.map((r) => ({ type: 'product.upsert' as const, p: { ...productPayload(r.p), sell: r.next! } })));
    toast(`Ціну продажу встановлено для ${valid.length} товарів`);
    onClose();
  }

  return (
    <Modal
      title={title || 'Націнка й ціни продажу'}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>
            Зміниться цін: <b>{valid.length}</b>
            {noCost ? ` · без закупівельної ціни: ${noCost} (пропущено)` : ''}
          </span>
          <button className="btn" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn primary" disabled={!valid.length} onClick={apply}>
            Застосувати
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          Для яких товарів
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            {ids?.length ? <option value="ids">{title ? 'З цієї накладної' : 'Вибрані'} ({ids.length})</option> : null}
            <option value="noprice">Без ціни продажу ({noPrice.length})</option>
            <option value="category">Категорія…</option>
            <option value="all">Усі товари ({ledger.productList.length})</option>
          </select>
        </label>
        {scope === 'category' && (
          <label className="field">
            Категорія
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              {ledger.categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Націнка, %
          <input value={pct} inputMode="decimal" onChange={(e) => setPct(e.target.value)} autoFocus disabled={byCat} />
          {m === null && !byCat && <span className="err">Вкажіть число</span>}
        </label>
        <label className="field">
          Округлення
          <select value={rounding} onChange={(e) => setRounding(e.target.value as Rounding)}>
            <option value="1">Вгору до 1 грн</option>
            <option value="0.5">Вгору до 0,50 грн</option>
            <option value="9">На …9 грн, де це до +10% (49, 89, 129)</option>
            <option value="none">Без округлення</option>
          </select>
        </label>
      </div>
      <div className="chips" role="group" aria-label="Швидкий вибір націнки">
        {['30', '40', '50', '60', '80', '100'].map((v) => (
          <button key={v} className="chip" aria-pressed={!byCat && pct === v} onClick={() => { setByCat(false); setPct(v); }}>
            {v}%
          </button>
        ))}
        {cats.length > 1 && (
          <button className="chip" aria-pressed={byCat} onClick={() => setByCat(!byCat)}>
            Окремо по категоріях
          </button>
        )}
      </div>
      {byCat && (
        <div className="form-grid">
          {cats.map((c) => (
            <label key={c} className="field">
              {c}, %
              <input value={catPct[c] ?? pct} inputMode="decimal" onChange={(e) => setCatPct({ ...catPct, [c]: e.target.value })} />
            </label>
          ))}
        </div>
      )}
      <div className="tablebox" style={{ maxHeight: '46vh', overflowY: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Товар</th>
              <th className="r">Закупівля</th>
              <th className="r">Була ціна</th>
              <th className="r">Нова ціна</th>
              <th className="r">Прибуток / од.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, cost, next }) => (
              <tr key={p.pid}>
                <td className="wrap">{p.name}</td>
                <td className="r num">{cost ? money(cost) : '—'}</td>
                <td className="r num muted">{p.sell ? money(p.sell) : 'немає'}</td>
                <td className="r num" style={{ fontWeight: 600 }}>
                  {next !== null ? money(next) : <span className="muted">—</span>}
                </td>
                <td className="r num good">{next !== null ? money(next - cost, { sign: true }) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">Немає товарів</div>}
      </div>
      <div className="hint" style={{ fontSize: 12 }}>
        Націнка рахується від середньої закупівельної ціни. Окрему ціну завжди можна змінити в картці товару.
      </div>
    </Modal>
  );
}
