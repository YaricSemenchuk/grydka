import * as XLSX from 'xlsx';
import { avgCost, type Ledger, type Report } from './core/ledger';
import { lineTotal, parseNum, uid } from './core/format';
import { PAY_LABEL, type EventType, type Line, type Payloads, type Unit } from './core/types';

const UAH = (kop: number) => Math.round(kop) / 100;
const QTY = (milli: number) => milli / 1000;
const KIND: Record<string, string> = { sale: 'Продаж', return: 'Повернення', purchase: 'Закупівля', expense: 'Витрата', adjust: 'Коригування' };

function sheet(rows: (string | number | null)[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  return ws;
}

export function exportReportXlsx(ledger: Ledger, r: Report, title: string, shop: string): Uint8Array {
  const wb = XLSX.utils.book_new();
  const pctOf = (v: number) => (r.revenue ? Math.round((v / r.revenue) * 1000) / 10 : null);

  const pl: (string | number | null)[][] = [
    [`${shop} — звіт про прибуток`],
    [`Період: ${title}`],
    [],
    ['Стаття', 'Сума, грн', '% виторгу'],
    ['Виторг від продажів', UAH(r.revenue), 100],
    ['Собівартість проданих товарів', -UAH(r.cogs), pctOf(r.cogs)],
    ['Валовий прибуток', UAH(r.gross), pctOf(r.gross)],
    ['Витрати магазину', -UAH(r.expenses), pctOf(r.expenses)],
    ...r.byCat.map((c) => [`   ${c.cat}`, -UAH(c.amount), pctOf(c.amount)]),
  ];
  if (r.writeoffs) pl.push(['Списання товару', -UAH(r.writeoffs), pctOf(r.writeoffs)]);
  pl.push(['ЧИСТИЙ ПРИБУТОК', UAH(r.net), pctOf(r.net)], [], ['Чеків', r.checks], ['Середній чек, грн', UAH(r.avgCheck)], ['Повернень', r.returns]);
  pl.push(['Надійшло готівкою, грн', UAH(r.byPay.cash)], ['Надійшло карткою, грн', UAH(r.byPay.card)], ['Закупівлі товару за період, грн', UAH(r.purchases)]);
  XLSX.utils.book_append_sheet(wb, sheet(pl, [36, 16, 12]), 'Прибуток');

  const days = [['Дата', 'Чеків', 'Виторг, грн', 'Чистий прибуток, грн']];
  for (const d of r.byDay) days.push([d.date.toLocaleDateString('uk-UA'), d.checks as never, UAH(d.revenue) as never, UAH(d.profit) as never]);
  XLSX.utils.book_append_sheet(wb, sheet(days, [14, 8, 14, 20]), 'По днях');

  const top = [['Товар', 'Продано', 'Од.', 'Виторг, грн', 'Прибуток, грн']] as (string | number)[][];
  for (const t of r.top) top.push([t.name, QTY(t.qty), t.unit, UAH(t.revenue), UAH(t.profit)]);
  XLSX.utils.book_append_sheet(wb, sheet(top, [40, 10, 6, 14, 14]), 'Товари');

  const f = r.from.toISOString();
  const t = r.to.toISOString();
  const ops = [['Дата й час', 'Тип', 'Опис', 'Сума, грн', 'Прибуток, грн', 'Оплата', 'Пристрій', 'Скасовано', 'Коментар']] as (string | number)[][];
  for (const o of ledger.ops) {
    if (o.ts < f || o.ts >= t) continue;
    ops.push([
      new Date(o.ts).toLocaleString('uk-UA'),
      KIND[o.kind],
      o.title,
      UAH(o.amount),
      UAH(o.revenue - o.cogs - o.expense - o.writeoff),
      o.pay ? PAY_LABEL[o.pay] : '',
      o.device,
      o.voided ? 'так' : '',
      o.note || o.voidReason || '',
    ]);
  }
  XLSX.utils.book_append_sheet(wb, sheet(ops, [18, 12, 44, 12, 14, 12, 14, 10, 30]), 'Операції');
  XLSX.utils.book_append_sheet(wb, stockSheet(ledger), 'Склад');

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

const HEAD = ['Назва', 'Категорія', 'Од.', 'Ціна продажу', 'Ціна закупівлі', 'Залишок', 'Мін. залишок', 'Штрихкод'];

function stockSheet(ledger: Ledger) {
  const rows = [HEAD] as (string | number)[][];
  for (const p of ledger.productList) rows.push([p.name, p.category, p.unit, UAH(p.sell), UAH(Math.round(avgCost(p))), QTY(p.stock), QTY(p.min), p.barcode || '']);
  return sheet(rows, [40, 18, 6, 14, 14, 10, 12, 16]);
}

export function exportProductsXlsx(ledger: Ledger): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, stockSheet(ledger), 'Товари');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

export function templateXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([HEAD], [40, 18, 6, 14, 14, 10, 12, 16]), 'Товари');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

export interface ImportPlan {
  events: { type: EventType; p: Payloads[EventType] }[];
  created: number;
  updated: number;
  stockLines: number;
  stockValue: number;
  skipped: string[];
}

const UNITS: Unit[] = ['шт', 'уп', 'кг', 'г', 'л'];

/** Розібрати Excel/CSV з товарами. Колонки шукаємо за назвою, регістр не важливий. */
export function planImport(bytes: Uint8Array, ledger: Ledger): ImportPlan {
  const wb = XLSX.read(bytes, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, blankrows: false, raw: true });
  const plan: ImportPlan = { events: [], created: 0, updated: 0, stockLines: 0, stockValue: 0, skipped: [] };
  if (!rows.length) return plan;
  const head = rows[0].map((h) => String(h ?? '').trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.startsWith(n)));
  const c = {
    name: col('назва', 'название', 'товар', 'name'),
    cat: col('категор'),
    unit: col('од', 'ед', 'unit'),
    sell: col('ціна продаж', 'цена продаж', 'продаж', 'роздріб', 'price'),
    buy: col('ціна закуп', 'цена закуп', 'закуп', 'собів'),
    stock: col('залишок', 'остаток', 'кільк', 'колич', 'qty'),
    min: col('мін', 'мин'),
    barcode: col('штрих', 'barcode', 'ean'),
  };
  if (c.name < 0) {
    plan.skipped.push('Не знайдено колонку «Назва» у першому рядку');
    return plan;
  }
  const byName = new Map(ledger.productList.map((p) => [p.name.trim().toLowerCase(), p]));
  const byCode = new Map(ledger.productList.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  const stock: Line[] = [];

  rows.slice(1).forEach((r, i) => {
    const name = String(r[c.name] ?? '').trim();
    if (!name) return;
    const barcode = c.barcode >= 0 ? String(r[c.barcode] ?? '').trim() : '';
    const existing = (barcode && byCode.get(barcode)) || byName.get(name.toLowerCase());
    const sell = c.sell >= 0 ? parseNum(r[c.sell] as string) : null;
    const buy = c.buy >= 0 ? parseNum(r[c.buy] as string) : null;
    const qty = c.stock >= 0 ? parseNum(r[c.stock] as string) : null;
    const min = c.min >= 0 ? parseNum(r[c.min] as string) : null;
    const unitRaw = c.unit >= 0 ? String(r[c.unit] ?? '').trim().toLowerCase().replace('.', '') : '';
    const unit = (UNITS.find((u) => u === unitRaw) || (unitRaw === 'пак' ? 'уп' : existing?.unit) || 'шт') as Unit;
    if (sell === null && !existing) {
      plan.skipped.push(`Рядок ${i + 2}: «${name}» — немає ціни продажу`);
      return;
    }
    const pid = existing?.pid || uid();
    plan.events.push({
      type: 'product.upsert',
      p: {
        pid,
        name,
        category: (c.cat >= 0 && String(r[c.cat] ?? '').trim()) || existing?.category || 'Без категорії',
        unit,
        sell: sell !== null ? Math.round(sell * 100) : existing!.sell,
        min: min !== null ? Math.round(min * 1000) : existing?.min || 0,
        barcode: barcode || existing?.barcode,
      },
    });
    if (existing) plan.updated++;
    else plan.created++;
    if (qty && qty > 0 && buy !== null && buy >= 0) {
      const line = { pid, qty: Math.round(qty * 1000), price: Math.round(buy * 100) };
      stock.push(line);
      plan.stockValue += lineTotal(line.qty, line.price);
    }
  });
  if (stock.length) {
    plan.stockLines = stock.length;
    plan.events.push({ type: 'purchase', p: { supplier: 'Початкові залишки', note: 'Імпорт з Excel', items: stock } });
  }
  return plan;
}
