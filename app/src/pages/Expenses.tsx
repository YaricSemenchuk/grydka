import { useEffect, useMemo, useRef, useState } from 'react';
import { buildReport } from '../core/ledger';
import { fmtDateTime, money, parseMoney } from '../core/format';
import { store } from '../core/store';
import { EXPENSE_CATEGORIES, PAY_LABEL, type Pay } from '../core/types';
import { todayStamp } from '../platform';
import { PeriodPicker, periodTitle, usePeriod, useStore, useToast } from '../ui';

export function Expenses({ focusNonce }: { focusNonce: number }) {
  const { ledger } = useStore();
  const toast = useToast();
  const { value, setValue, range } = usePeriod('month');
  const [cat, setCat] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [pay, setPay] = useState<Pay>('cash');
  const [date, setDate] = useState(todayStamp());
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    amountRef.current?.focus();
  }, [focusNonce]);

  const cats = useMemo(() => [...new Set([...EXPENSE_CATEGORIES, ...ledger.expenseCats])], [ledger]);
  const r = useMemo(() => buildReport(ledger, range.from, range.to), [ledger, range.from.getTime(), range.to.getTime()]);
  const list = useMemo(() => {
    const f = range.from.toISOString();
    const t = range.to.toISOString();
    return ledger.ops.filter((o) => (o.kind === 'expense' || (o.kind === 'adjust' && o.writeoff > 0)) && o.ts >= f && o.ts < t);
  }, [ledger, range.from.getTime(), range.to.getTime()]);
  const maxCat = Math.max(1, ...r.byCat.map((c) => c.amount));
  const amt = parseMoney(amount);
  const valid = amt !== null && amt > 0 && cat.trim();

  async function save() {
    setTried(true);
    if (!valid) return;
    const isToday = date === todayStamp();
    const [y, m, d] = date.split('-').map(Number);
    await store.add('expense', { cat: cat.trim(), amount: amt!, pay, note: note.trim() || undefined }, isToday ? undefined : new Date(y, m - 1, d, 12, 0).toISOString());
    toast(`Витрату збережено: ${money(amt!)}`);
    setAmount('');
    setNote('');
    setTried(false);
    amountRef.current?.focus();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Витрати</h1>
          <div className="sub">Оренда, зарплата, реклама та інше, що зменшує прибуток · {periodTitle(value, range)}</div>
        </div>
        <PeriodPicker value={value} onChange={setValue} />
      </div>

      <section className="grid-2" style={{ alignItems: 'start' }}>
        <form
          className="card"
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <h2>Нова витрата</h2>
          <div className="chips" role="group" aria-label="Категорія">
            {cats.map((c) => (
              <button type="button" key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="form-grid">
            <label className="field">
              Сума, грн *
              <input ref={amountRef} value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              {tried && !(amt !== null && amt > 0) && <span className="err">Вкажіть суму</span>}
            </label>
            <label className="field">
              Інша категорія
              <input value={cats.includes(cat) ? '' : cat} onChange={(e) => setCat(e.target.value || EXPENSE_CATEGORIES[0])} placeholder="Наприклад: ремонт" />
            </label>
            <label className="field">
              Оплата
              <select value={pay} onChange={(e) => setPay(e.target.value as Pay)}>
                <option value="cash">Готівка</option>
                <option value="card">Картка</option>
                <option value="bank">Безготівка</option>
              </select>
            </label>
            <label className="field">
              Дата
              <input type="date" value={date} max={todayStamp()} onChange={(e) => setDate(e.target.value || todayStamp())} />
            </label>
          </div>
          <label className="field">
            Коментар
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="За що саме" />
          </label>
          <button className="btn primary big" type="submit">
            Зберегти витрату
          </button>
        </form>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>За категоріями</h2>
            <b className="num warn">{money(r.expenses + r.writeoffs)}</b>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
            {r.byCat.length || r.writeoffs ? (
              <>
                {r.byCat.map((c) => (
                  <div key={c.cat}>
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                      <span>{c.cat}</span>
                      <span className="num">{money(c.amount)}</span>
                    </div>
                    <div className="meter">
                      <div style={{ width: `${(c.amount / maxCat) * 100}%`, background: '#D19A4C' }} />
                    </div>
                  </div>
                ))}
                {r.writeoffs !== 0 && (
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>Списання товару</span>
                    <span className="num">{money(r.writeoffs)}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="hint">За цей період витрат немає</div>
            )}
          </div>
        </div>
      </section>

      <div className="tablebox">
        {list.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Категорія</th>
                <th>Коментар</th>
                <th className="r">Сума</th>
                <th>Оплата</th>
                <th>Пристрій</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className={o.voided ? 'voided' : ''}>
                  <td className="num">{fmtDateTime(o.ts)}</td>
                  <td>{o.kind === 'adjust' ? 'Списання товару' : o.cat}</td>
                  <td className="wrap muted">{o.kind === 'adjust' ? `${o.lines[0]?.name} — ${o.note}` : o.note}</td>
                  <td className="r num warn">{money(o.kind === 'adjust' ? o.writeoff : o.expense)}</td>
                  <td>{o.pay ? PAY_LABEL[o.pay] : ''}</td>
                  <td className="muted">{o.device}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Витрат за цей період немає</div>
        )}
      </div>
      <div className="hint" style={{ fontSize: 13 }}>
        Помилкову витрату можна скасувати в журналі «Операції».
      </div>
    </>
  );
}
