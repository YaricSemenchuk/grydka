import { useMemo } from 'react';
import { buildReport, dayKey } from '../core/ledger';
import { money, qty } from '../core/format';
import { exportReportXlsx } from '../excel';
import { saveFile } from '../platform';
import { PeriodPicker, periodTitle, usePeriod, useStore, useToast } from '../ui';

export function Reports() {
  const { ledger, settings } = useStore();
  const toast = useToast();
  const { value, setValue, range } = usePeriod('month');
  const r = useMemo(() => buildReport(ledger, range.from, range.to), [ledger, range.from.getTime(), range.to.getTime()]);
  const title = periodTitle(value, range);
  const p = (v: number) => (r.revenue ? `${((v / r.revenue) * 100).toFixed(1).replace('.', ',').replace(',0', '')}%` : '—');

  // по днях (до 62 днів) або по місяцях
  const { rows, byMonth } = useMemo(() => {
    const now = new Date();
    const days = r.byDay.filter((d) => d.date <= now);
    if (days.length <= 62) return { byMonth: false, rows: days.map((d) => ({ key: d.date.toISOString(), label: d.date.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' }), ...d })) };
    const m = new Map<string, { key: string; label: string; revenue: number; profit: number; checks: number }>();
    for (const d of days) {
      const key = `${d.date.getFullYear()}-${d.date.getMonth()}`;
      const row = m.get(key) || { key, label: d.date.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' }), revenue: 0, profit: 0, checks: 0 };
      row.revenue += d.revenue;
      row.profit += d.profit;
      row.checks += d.checks;
      m.set(key, row);
    }
    return { byMonth: true, rows: [...m.values()] };
  }, [r]);
  const maxRev = Math.max(1, ...rows.map((x) => x.revenue));
  const payTotal = Math.max(1, r.byPay.cash + r.byPay.card + r.byPay.bank);

  async function exportXlsx() {
    const ok = await saveFile(`gryadka-zvit-${dayKey(range.from)}.xlsx`, exportReportXlsx(ledger, r, title, settings.shopName), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (ok) toast('Звіт збережено');
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Звіт про прибуток</h1>
          <div className="sub">
            {settings.shopName} · {title}
          </div>
        </div>
        <div className="row no-print">
          <PeriodPicker value={value} onChange={setValue} />
          <button className="btn" onClick={() => window.print()}>
            Друк
          </button>
          <button className="btn primary" onClick={exportXlsx}>
            Експорт в Excel
          </button>
        </div>
      </div>

      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
        <div className="tablebox" style={{ flex: '999 1 480px', minWidth: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Стаття</th>
                <th className="r">Сума</th>
                <th className="r">% виторгу</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600 }}>Виторг від продажів</td>
                <td className="r num" style={{ fontWeight: 600 }}>
                  {money(r.revenue)}
                </td>
                <td className="r num">{r.revenue ? '100%' : '—'}</td>
              </tr>
              <tr>
                <td>− Собівартість проданих товарів</td>
                <td className="r num">{money(-r.cogs)}</td>
                <td className="r num">{p(r.cogs)}</td>
              </tr>
              <tr style={{ background: '#F3F8F4' }}>
                <td style={{ fontWeight: 600 }}>= Валовий прибуток</td>
                <td className="r num good" style={{ fontWeight: 600 }}>
                  {money(r.gross)}
                </td>
                <td className="r num">{p(r.gross)}</td>
              </tr>
              <tr>
                <td>− Витрати магазину</td>
                <td className="r num warn">{money(-r.expenses)}</td>
                <td className="r num">{p(r.expenses)}</td>
              </tr>
              {r.byCat.map((c) => (
                <tr key={c.cat}>
                  <td style={{ paddingLeft: 34 }} className="muted">
                    {c.cat}
                  </td>
                  <td className="r num">{money(c.amount)}</td>
                  <td className="r num">{p(c.amount)}</td>
                </tr>
              ))}
              {r.writeoffs !== 0 && (
                <tr>
                  <td>− Списання товару</td>
                  <td className="r num warn">{money(-r.writeoffs)}</td>
                  <td className="r num">{p(r.writeoffs)}</td>
                </tr>
              )}
              <tr style={{ background: 'var(--side)' }}>
                <td style={{ fontWeight: 700, color: '#fff' }}>= Чистий прибуток</td>
                <td className="r num" style={{ fontWeight: 700, fontSize: 18, color: r.net >= 0 ? 'var(--good-on-dark)' : '#ffb4a8' }}>
                  {money(r.net)}
                </td>
                <td className="r num" style={{ color: '#fff' }}>
                  {p(r.net)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Надходження в касу</h2>
            {(
              [
                ['cash', 'Готівка', 'var(--accent)'],
                ['card', 'Картка', 'var(--blue)'],
              ] as const
            ).map(([k, label, color]) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>{label}</span>
                  <span className="num">{money(r.byPay[k])}</span>
                </div>
                <div className="meter">
                  <div style={{ width: `${Math.max(0, (r.byPay[k] / payTotal) * 100)}%`, background: color }} />
                </div>
              </div>
            ))}
            <div className="hint" style={{ fontSize: 13 }}>
              {r.checks} чеків · середній {money(r.avgCheck)}
              {r.returns ? ` · повернень ${r.returns}` : ''}
            </div>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 6 }}>Закупівлі товару</h2>
            <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>
              {money(r.purchases)}
            </div>
            <div className="hint" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              Гроші пішли на склад, а не в збиток. У прибуток вони потраплять частинами — коли товар продасться.
            </div>
          </div>
        </div>
      </section>

      <section className="grid-2" style={{ alignItems: 'start' }}>
        <div className="tablebox" style={{ paddingTop: 16 }}>
          <h2 style={{ fontSize: 16, padding: '0 12px 6px' }}>По {byMonth ? 'місяцях' : 'днях'}</h2>
          {rows.some((x) => x.checks || x.revenue || x.profit) ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Період</th>
                  <th className="r">Чеків</th>
                  <th className="r">Виторг</th>
                  <th className="r">Чистий прибуток</th>
                  <th style={{ width: '28%' }} />
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((x) => x.checks || x.revenue || x.profit)
                  .map((x) => (
                    <tr key={x.key}>
                      <td>{x.label}</td>
                      <td className="r num">{x.checks}</td>
                      <td className="r num">{money(x.revenue)}</td>
                      <td className={`r num ${x.profit >= 0 ? 'good' : 'warn'}`} style={{ fontWeight: 600 }}>
                        {money(x.profit)}
                      </td>
                      <td>
                        <div className="meter" style={{ height: 10 }}>
                          <div style={{ width: `${Math.max(0, (x.revenue / maxRev) * 100)}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Немає даних за цей період</div>
          )}
        </div>

        <div className="tablebox" style={{ paddingTop: 16 }}>
          <h2 style={{ fontSize: 16, padding: '0 12px 6px' }}>Прибуток по товарах</h2>
          {r.top.length ? (
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
                {r.top.slice(0, 50).map((t) => (
                  <tr key={t.pid}>
                    <td className="wrap">{t.name}</td>
                    <td className="r num">
                      {qty(t.qty)} {t.unit}
                    </td>
                    <td className="r num">{money(t.revenue)}</td>
                    <td className={`r num ${t.profit >= 0 ? 'good' : 'warn'}`}>{money(t.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Немає продажів за цей період</div>
          )}
        </div>
      </section>
    </>
  );
}
