import { useMemo, useState } from 'react';
import type { Op, OpKind } from '../core/ledger';
import { fmtDateTime, money, qty } from '../core/format';
import { store } from '../core/store';
import { PAY_LABEL } from '../core/types';
import { Confirm, Icon, Modal, PeriodPicker, periodTitle, usePeriod, useStore, useToast } from '../ui';
import { SaleForm } from './SaleForm';

const KIND_LABEL: Record<OpKind, string> = { sale: 'Продаж', return: 'Повернення', purchase: 'Закупівля', expense: 'Витрата', adjust: 'Коригування' };
const FILTERS: [OpKind | 'all', string][] = [
  ['all', 'Усі'],
  ['sale', 'Продажі'],
  ['purchase', 'Закупівлі'],
  ['expense', 'Витрати'],
  ['return', 'Повернення'],
  ['adjust', 'Списання'],
];

export function Operations({ focusNonce }: { focusNonce: number }) {
  const { ledger } = useStore();
  const { value, setValue, range } = usePeriod('day');
  const [kind, setKind] = useState<OpKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Op | null>(null);

  const list = useMemo(() => {
    const f = range.from.toISOString();
    const t = range.to.toISOString();
    const s = q.trim().toLowerCase();
    return ledger.ops.filter(
      (o) =>
        o.ts >= f &&
        o.ts < t &&
        (kind === 'all' || o.kind === kind) &&
        (!s || o.title.toLowerCase().includes(s) || (o.note || '').toLowerCase().includes(s) || o.lines.some((l) => l.name.toLowerCase().includes(s))),
    );
  }, [ledger, range.from.getTime(), range.to.getTime(), kind, q]);

  const live = list.filter((o) => !o.voided);
  const income = live.filter((o) => o.kind === 'sale' || o.kind === 'return').reduce((s, o) => s + o.amount, 0);
  const salesProfit = live.reduce((s, o) => s + o.revenue - o.cogs, 0);
  const expenses = live.reduce((s, o) => s + o.expense, 0);
  const current = open ? ledger.opById.get(open.id) || open : null;

  return (
    <>
      <div className="ops-layout">
        <div className="journal">
          <div className="page-head">
            <div>
              <h1>Операції</h1>
              <div className="sub">Усе, що надходить у касу й виходить із неї · {periodTitle(value, range)}</div>
            </div>
          </div>
          <div className="row">
            <div className="seg" role="group" aria-label="Тип операції">
              {FILTERS.map(([k, label]) => (
                <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <label className="search">
              {Icon.search()}
              <input type="search" aria-label="Пошук" placeholder="Пошук за товаром або коментарем" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <PeriodPicker value={value} onChange={setValue} />
          </div>

          <div className="tablebox">
            {list.length ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Час</th>
                    <th>Тип</th>
                    <th>Опис</th>
                    <th className="r">Сума</th>
                    <th className="r">Прибуток</th>
                    <th>Оплата</th>
                    <th>Пристрій</th>
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, 500).map((o) => {
                    const profit = o.revenue - o.cogs - o.expense - o.writeoff;
                    return (
                      <tr key={o.id} className={`click${o.voided ? ' voided' : ''}`} onClick={() => setOpen(o)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(o)}>
                        <td className="num">{value.kind === 'day' ? new Date(o.ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) : fmtDateTime(o.ts)}</td>
                        <td>
                          <span className={`tag ${o.voided ? 'off' : o.kind}`}>{o.voided ? 'Скасовано' : KIND_LABEL[o.kind]}</span>
                          {o.returnedBy && !o.voided && !ledger.opById.get(o.returnedBy)?.voided && (
                            <span className="tag return" style={{ marginLeft: 6 }}>
                              повернено
                            </span>
                          )}
                        </td>
                        <td className="wrap" style={{ maxWidth: 340 }}>
                          {o.title}
                        </td>
                        <td className={`r num ${o.amount > 0 ? 'good' : o.kind === 'purchase' ? 'muted' : o.amount < 0 ? 'warn' : ''}`}>{o.amount ? money(o.amount, { sign: true }) : '—'}</td>
                        <td className="r num">{o.kind === 'purchase' ? <span className="muted">на склад</span> : profit ? money(profit, { sign: true }) : '—'}</td>
                        <td>{o.pay ? PAY_LABEL[o.pay] : ''}</td>
                        <td className="muted">{o.device}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="empty">За цей період операцій немає</div>
            )}
            {list.length > 500 && <div className="empty">Показано 500 останніх — звузьте період або скористайтесь пошуком</div>}
            <div className="tfoot">
              <span>
                Надходження від продажів: <b className="num">{money(income)}</b>
              </span>
              <span>
                Прибуток із продажів: <b className="num">{money(salesProfit)}</b>
              </span>
              <span>
                Витрати: <b className="num warn">{money(expenses)}</b>
              </span>
            </div>
          </div>
          <div className="hint" style={{ fontSize: 13 }}>
            Закупівля не зменшує прибуток одразу: товар іде на склад, а в собівартість потрапляє лише тоді, коли його продано. Натисніть на рядок, щоб переглянути
            деталі, оформити повернення або скасувати помилкову операцію.
          </div>
        </div>
        <SaleForm focusNonce={focusNonce} />
      </div>
      {current && <OpDetails op={current} onClose={() => setOpen(null)} />}
    </>
  );
}

function OpDetails({ op, onClose }: { op: Op; onClose: () => void }) {
  const { ledger } = useStore();
  const toast = useToast();
  const [ask, setAsk] = useState<'return' | 'void' | null>(null);
  const [reason, setReason] = useState('');
  const returned = op.returnedBy && !ledger.opById.get(op.returnedBy)?.voided;
  const profit = op.revenue - op.cogs - op.expense - op.writeoff;

  return (
    <>
      <Modal title={`${KIND_LABEL[op.kind]} · ${fmtDateTime(op.ts)}`} onClose={onClose} wide>
        <div className="row" style={{ gap: 18 }}>
          {op.voided && <span className="tag off">Скасовано{op.voidReason ? `: ${op.voidReason}` : ''}</span>}
          {returned && <span className="tag return">Повернено покупцем</span>}
          <span className="muted">Пристрій: {op.device}</span>
          {op.pay && <span className="muted">Оплата: {PAY_LABEL[op.pay]}</span>}
          {op.cat && <span className="muted">Категорія: {op.cat}</span>}
        </div>
        {op.lines.length > 0 && (
          <div className="tablebox">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="r">К-сть</th>
                  {op.kind !== 'adjust' && <th className="r">Ціна</th>}
                  {op.kind !== 'adjust' && <th className="r">Сума</th>}
                  <th className="r">Собівартість</th>
                </tr>
              </thead>
              <tbody>
                {op.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="wrap">{l.name}</td>
                    <td className="r num">
                      {qty(l.qty)} {l.unit}
                    </td>
                    {op.kind !== 'adjust' && <td className="r num">{money(l.price)}</td>}
                    {op.kind !== 'adjust' && <td className="r num">{money(l.net)}</td>}
                    <td className="r num muted">{money(l.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="totals">
          {op.discount ? (
            <div>
              <span className="muted">Знижка</span>
              <span className="num">{money(op.discount)}</span>
            </div>
          ) : null}
          {op.kind !== 'purchase' && op.kind !== 'expense' && (
            <div>
              <span className="muted">{op.kind === 'adjust' ? 'Вплив на прибуток' : 'Прибуток'}</span>
              <span className={`num ${profit >= 0 ? 'good' : 'warn'}`}>{money(profit, { sign: true })}</span>
            </div>
          )}
          <div className="grand">
            <span>{op.kind === 'purchase' ? 'Сума закупівлі' : op.kind === 'expense' ? 'Сума витрати' : op.kind === 'adjust' ? 'Собівартість' : 'Сума'}</span>
            <span className="num">{money(op.kind === 'adjust' ? op.writeoff : Math.abs(op.amount))}</span>
          </div>
        </div>
        {op.note && <div className="muted">Коментар: {op.note}</div>}
        {!op.voided && (
          <div className="modal-foot" style={{ justifyContent: 'space-between' }}>
            <span className="hint" style={{ fontSize: 12, maxWidth: 380 }}>
              Скасування прибирає операцію з обліку й складу, але вона лишається в журналі закресленою.
            </span>
            <div className="row">
              {op.kind === 'sale' && !returned && (
                <button className="btn" onClick={() => setAsk('return')}>
                  Оформити повернення
                </button>
              )}
              {!returned && (
                <button className="btn danger" onClick={() => setAsk('void')}>
                  Скасувати операцію
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
      {ask === 'return' && (
        <Confirm
          title="Повернення товару"
          text={
            <>
              Покупцю повертається <b className="num">{money(op.revenue)}</b>, товар повертається на склад. Виторг зменшиться сьогоднішнім днем.
            </>
          }
          ok="Оформити повернення"
          onClose={() => setAsk(null)}
          onOk={async () => {
            await store.add('sale.return', { saleId: op.id, note: reason || undefined });
            toast('Повернення оформлено');
            onClose();
          }}
        >
          <label className="field">
            Причина (необов’язково)
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Наприклад: брак пакування" />
          </label>
        </Confirm>
      )}
      {ask === 'void' && (
        <Confirm
          title="Скасувати операцію?"
          text="Використовуйте, якщо операцію внесли помилково. Вона зникне зі звітів, а залишки на складі відновляться."
          ok="Скасувати операцію"
          danger
          onClose={() => setAsk(null)}
          onOk={async () => {
            await store.add('void', { target: op.id, reason: reason || 'Помилка введення' });
            toast('Операцію скасовано');
            onClose();
          }}
        >
          <label className="field">
            Причина
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Помилка введення" />
          </label>
        </Confirm>
      )}
    </>
  );
}
