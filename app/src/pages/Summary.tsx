import { useMemo } from 'react';
import { buildReport, clampToToday, dayKey } from '../core/ledger';
import { fmtTime, money, pct, qty } from '../core/format';
import { Icon, PeriodPicker, periodTitle, usePeriod, useStore } from '../ui';
import type { Go } from '../App';

export function Summary({ go }: { go: Go }) {
  const { ledger } = useStore();
  const { value, setValue, range } = usePeriod('month');
  const r = useMemo(() => buildReport(ledger, range.from, range.to), [ledger, range.from.getTime(), range.to.getTime()]);
  const chart = useMemo(() => {
    const cr = clampToToday(range);
    const rep = cr.to > cr.from ? buildReport(ledger, cr.from, cr.to) : r;
    if (value.kind === 'year') {
      // по місяцях
      const months = Array.from({ length: 12 }, (_, m) => ({ label: String(m + 1), revenue: 0, key: m }));
      for (const d of rep.byDay) months[d.date.getMonth()].revenue += d.revenue;
      const upto = new Date().getFullYear() === range.from.getFullYear() ? new Date().getMonth() + 1 : 12;
      return { bars: months.slice(0, upto).map((m) => ({ ...m, today: m.key === new Date().getMonth(), title: `${m.label} міс.: ${money(m.revenue)}` })), unit: 'місяць' };
    }
    const todayKey = dayKey(new Date());
    return {
      bars: rep.byDay.map((d) => ({ label: String(d.date.getDate()), revenue: d.revenue, key: dayKey(d.date), today: dayKey(d.date) === todayKey, title: `${d.date.toLocaleDateString('uk-UA')}: ${money(d.revenue)}, чеків ${d.checks}` })),
      unit: 'день',
    };
  }, [ledger, r, value.kind, range.from.getTime(), range.to.getTime()]);
  const max = Math.max(1, ...chart.bars.map((b) => b.revenue));
  const best = chart.bars.reduce((a, b) => (b.revenue > (a?.revenue ?? -1) ? b : a), chart.bars[0]);

  const low = ledger.productList.filter((p) => p.min > 0 && p.stock < p.min);
  const recent = ledger.ops.filter((o) => !o.voided).slice(0, 6);
  const top = r.top.slice(0, 6);

  const share = (v: number) => (r.revenue > 0 ? Math.max(0, Math.min(100, (v / r.revenue) * 100)) : 0);
  const cascade = [
    { label: 'Виторг', left: 0, w: r.revenue > 0 ? 100 : 0, color: 'var(--accent)', value: money(r.revenue, { whole: true }), bold: true },
    { label: '− Собівартість', left: 100 - share(r.cogs), w: share(r.cogs), color: '#B9C4BC', value: money(-r.cogs, { whole: true }) },
    { label: '= Валовий прибуток', left: 0, w: share(r.gross), color: '#6FA77B', value: money(r.gross, { whole: true }), bold: true },
    { label: '− Витрати й списання', left: Math.max(0, share(r.gross) - share(r.expenses + r.writeoffs)), w: share(r.expenses + r.writeoffs), color: '#D19A4C', value: money(-(r.expenses + r.writeoffs), { whole: true }) },
    { label: '= Чистий прибуток', left: 0, w: share(Math.max(0, r.net)), color: 'var(--side)', value: money(r.net, { whole: true }), bold: true },
  ];

  const empty = ledger.eventCount === 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Зведення</h1>
          <div className="sub">{periodTitle(value, range)} · усі суми в гривнях</div>
        </div>
        <div className="row">
          <PeriodPicker value={value} onChange={setValue} />
          <button className="btn" onClick={() => go('expenses', { newExpense: true })}>
            + Витрата <span className="kbd">F3</span>
          </button>
          <button className="btn primary" onClick={() => go('ops', { focusSale: true })}>
            + Продаж <span className="kbd">F2</span>
          </button>
        </div>
      </div>

      {empty && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>З чого почати</h2>
          <div className="hint" style={{ lineHeight: 1.6 }}>
            1. Додайте товари з закупівельними цінами — вручну або імпортом з Excel.
            <br />
            2. Оформіть надходження товару, щоб на складі з’явились залишки.
            <br />
            3. Продавайте через «Новий продаж» (F2) — прибуток порахується сам.
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => go('products')}>
              Перейти до товарів
            </button>
            <button className="btn" onClick={() => go('sync')}>
              Підключити сервер
            </button>
          </div>
        </div>
      )}

      <section className="grid-kpi" aria-label="Ключові показники">
        <div className="card kpi">
          <div className="label">Виторг (надходження)</div>
          <div className="val">{money(r.revenue, { whole: true })}</div>
          <div className="foot">
            {r.checks} чек{plural(r.checks, '', 'и', 'ів')} · середній чек {money(r.avgCheck, { whole: true })}
          </div>
        </div>
        <div className="card kpi">
          <div className="label">Собівартість проданого</div>
          <div className="val">{money(r.cogs, { whole: true })}</div>
          <div className="foot">за закупівельними цінами · {pct(r.cogs, r.revenue)} виторгу</div>
        </div>
        <div className="card kpi">
          <div className="label">Витрати магазину</div>
          <div className="val warn">{money(r.expenses + r.writeoffs, { whole: true })}</div>
          <div className="foot">{r.writeoffs ? `у т. ч. списання ${money(r.writeoffs, { whole: true })}` : 'оренда, зарплата, реклама тощо'}</div>
        </div>
        <div className="card kpi dark">
          <div className="label">Чистий прибуток</div>
          <div className="val">{money(r.net, { whole: true })}</div>
          <div className="foot">рентабельність {pct(r.net, r.revenue)} від виторгу</div>
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <h2>Як склався прибуток</h2>
          <div className="hint">Виторг − собівартість − витрати = чистий прибуток</div>
          <div className="cascade">
            {cascade.map((c) => (
              <div className="crow" key={c.label}>
                <div>{c.label}</div>
                <div className="track">
                  <div className="fill" style={{ left: `${c.left}%`, width: `${c.w}%`, background: c.color }} />
                </div>
                <div className="num" style={{ textAlign: 'right', fontWeight: c.bold ? 600 : 400 }}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Виторг по {chart.unit === 'місяць' ? 'місяцях' : 'днях'}</h2>
            {best && best.revenue > 0 && <div className="hint">макс. {money(best.revenue)}</div>}
          </div>
          <div className="bars" role="img" aria-label={`Діаграма виторгу по ${chart.unit === 'місяць' ? 'місяцях' : 'днях'}`}>
            {chart.bars.map((b) => (
              <div key={b.key} className={b.today ? 'today' : ''} title={b.title} style={{ height: `${(b.revenue / max) * 100}%` }} />
            ))}
          </div>
          <div className="bar-axis">
            <span>{chart.bars[0]?.label}</span>
            <span>{chart.bars[Math.floor(chart.bars.length / 2)]?.label}</span>
            <span>{chart.bars[chart.bars.length - 1]?.label}</span>
          </div>
        </div>
      </section>

      <section className="grid-2">
        <div className="tablebox" style={{ paddingTop: 16 }}>
          <h2 style={{ fontSize: 16, padding: '0 12px 6px' }}>Що приносить найбільше прибутку</h2>
          {top.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="r">Продано</th>
                  <th className="r">Виторг</th>
                  <th className="r">Прибуток</th>
                </tr>
              </thead>
              <tbody>
                {top.map((t) => (
                  <tr key={t.pid}>
                    <td className="wrap">{t.name}</td>
                    <td className="r num">
                      {qty(t.qty)} {t.unit}
                    </td>
                    <td className="r num">{money(t.revenue)}</td>
                    <td className="r num good">{money(t.profit, { whole: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">За цей період ще немає продажів</div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {low.length > 0 && (
            <div className="alert">
              <h2>
                {Icon.warn()} Закінчується — {low.length} {plural(low.length, 'товар', 'товари', 'товарів')}
              </h2>
              <div style={{ marginTop: 8, lineHeight: 1.6 }}>
                {low.slice(0, 5).map((p) => (
                  <div key={p.pid}>
                    {p.name} — <span className="num">{qty(p.stock)}</span> {p.unit}
                  </div>
                ))}
                {low.length > 5 && <div>і ще {low.length - 5}…</div>}
              </div>
              <button className="btn small" style={{ marginTop: 10 }} onClick={() => go('products', { lowOnly: true })}>
                Оформити закупівлю →
              </button>
            </div>
          )}
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Останні операції</h2>
            {recent.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recent.map((o) => (
                  <div key={o.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span className="num muted">{fmtTime(o.ts)}</span>&nbsp;&nbsp;{o.title}
                    </span>
                    <span className={`num ${o.amount > 0 ? 'good' : o.kind === 'purchase' ? 'muted' : 'warn'}`}>{o.amount ? money(o.amount, { sign: true }) : '—'}</span>
                  </div>
                ))}
                <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => go('ops')}>
                  Усі операції →
                </button>
              </div>
            ) : (
              <div className="hint">Операцій ще немає</div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
