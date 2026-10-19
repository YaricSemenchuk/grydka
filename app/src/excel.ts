import * as XLSX from 'xlsx';
import { avgCost, type Ledger, type Report } from './core/ledger';
import { lineTotal, parseNum, uid } from './core/format';
import { PAY_LABEL, normalizeUnit, type Line, type Payloads, type Unit } from './core/types';

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

const HEAD = ['Назва', 'Категорія', 'Од.', 'Ціна продажу', 'Ціна закупівлі', 'Залишок', 'Мін. залишок', 'Штрихкод', 'Артикул'];
const WIDTHS = [40, 18, 6, 14, 14, 10, 12, 16, 12];

function stockSheet(ledger: Ledger) {
  const rows = [HEAD] as (string | number)[][];
  for (const p of ledger.productList)
    rows.push([p.name, p.category, p.unit, UAH(p.sell), UAH(Math.round(avgCost(p))), QTY(p.stock), QTY(p.min), p.barcode || '', p.sku || '']);
  return sheet(rows, WIDTHS);
}

export function exportProductsXlsx(ledger: Ledger): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, stockSheet(ledger), 'Товари');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

export function templateXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([HEAD], WIDTHS), 'Товари');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

export interface ImportRow {
  row: number;
  pid: string;
  name: string;
  isNew: boolean;
  unit: Unit;
  qty: number | null; // milli
  buy: number | null; // коп
  sell: number | null; // коп, null — не вказано
}

export interface ImportPlan {
  /** invoice — накладна постачальника (Кількість + Ціна = прихід); catalog — список товарів */
  kind: 'invoice' | 'catalog';
  rows: ImportRow[];
  products: Payloads['product.upsert'][];
  stock: Line[];
  stockValue: number;
  created: number;
  updated: number;
  withoutPrice: number;
  skipped: string[];
  supplier?: string;
  date?: string; // YYYY-MM-DD з колонки «Дата», якщо є
}

/** «14.10.26», «14.10.2026», Excel-дата → YYYY-MM-DD */
function parseDate(v: unknown): string | undefined {
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400e3));
    return d.toISOString().slice(0, 10);
  }
  const m = String(v ?? '').trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!m) return undefined;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Розібрати Excel/CSV. Колонки шукаємо за назвою в першому рядку з «Назва»/«Товар». */
export function planImport(bytes: Uint8Array, ledger: Ledger): ImportPlan {
  const wb = XLSX.read(bytes, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const all = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, blankrows: false, raw: true });
  const plan: ImportPlan = { kind: 'catalog', rows: [], products: [], stock: [], stockValue: 0, created: 0, updated: 0, withoutPrice: 0, skipped: [] };
  // рядок заголовків може бути не першим (у накладних зверху шапка)
  const isName = (h: string) => /^(назва|название|товар|найменування|наименование|name)/.test(h);
  const headIdx = all.findIndex((r) => r.some((h) => isName(String(h ?? '').trim().toLowerCase())));
  if (headIdx < 0) {
    plan.skipped.push('Не знайдено колонку «Назва» або «Товар»');
    return plan;
  }
  const head = all[headIdx].map((h) => String(h ?? '').trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.startsWith(n)));
  const c = {
    name: head.findIndex(isName),
    cat: col('категор'),
    unit: col('од', 'ед', 'unit'),
    sell: col('ціна продаж', 'цена продаж', 'продаж', 'роздріб', 'розничн'),
    buy: col('ціна закуп', 'цена закуп', 'закуп', 'собів'),
    price: head.findIndex((h) => /^(ціна|цена|price)(?![a-zа-яіїєґ])/.test(h) && !/продаж|роздр|розн/.test(h)),
    stock: col('залишок', 'остаток'),
    qty: col('кіл', 'кол', 'qty'),
    min: col('мін', 'мин'),
    barcode: col('штрих', 'barcode', 'ean'),
    sku: col('артикул', 'код', 'sku'),
    date: col('дата'),
  };
  // накладна: є кількість і ціна, але немає окремих «ціна продажу»/«залишок»
  const invoice = c.qty >= 0 && c.stock < 0 && c.sell < 0 && (c.buy >= 0 || c.price >= 0);
  plan.kind = invoice ? 'invoice' : 'catalog';
  const buyCol = c.buy >= 0 ? c.buy : invoice ? c.price : -1;
  const qtyCol = c.stock >= 0 ? c.stock : c.qty;
  const sellCol = c.sell >= 0 ? c.sell : !invoice ? c.price : -1;

  const byName = new Map(ledger.productList.map((p) => [p.name.trim().toLowerCase(), p]));
  const byCode = new Map(ledger.productList.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  const bySku = new Map(ledger.productList.filter((p) => p.sku).map((p) => [p.sku!.toLowerCase(), p]));
  const seen = new Map<string, ImportRow>();
  const dates = new Set<string>();

  all.slice(headIdx + 1).forEach((r, i) => {
    const rowNo = headIdx + i + 2;
    const name = String(r[c.name] ?? '').replace(/\s+/g, ' ').trim();
    if (!name || /^(разом|всього|итого|усього)/i.test(name)) return;
    const str = (k: number) => (k >= 0 ? String(r[k] ?? '').trim() : '');
    const barcode = str(c.barcode);
    const sku = str(c.sku);
    const existing = (barcode && byCode.get(barcode)) || (sku && bySku.get(sku.toLowerCase())) || byName.get(name.toLowerCase());
    const sell = sellCol >= 0 ? parseNum(r[sellCol] as string) : null;
    const buy = buyCol >= 0 ? parseNum(r[buyCol] as string) : null;
    const qty = qtyCol >= 0 ? parseNum(r[qtyCol] as string) : null;
    const min = c.min >= 0 ? parseNum(r[c.min] as string) : null;
    const unit = normalizeUnit(str(c.unit), existing?.unit || 'шт');
    if (c.date >= 0) {
      const d = parseDate(r[c.date]);
      if (d) dates.add(d);
    }
    if (invoice && (qty === null || qty <= 0 || buy === null || buy < 0)) {
      plan.skipped.push(`Рядок ${rowNo}: «${name}» — немає кількості або ціни`);
      return;
    }
    // той самий товар двічі в одному файлі — додаємо кількість
    const dupe = seen.get(name.toLowerCase());
    if (dupe && invoice) {
      const line = plan.stock.find((l) => l.pid === dupe.pid)!;
      line.qty += Math.round(qty! * 1000);
      dupe.qty = line.qty;
      plan.stockValue += lineTotal(Math.round(qty! * 1000), Math.round(buy! * 100));
      return;
    }
    const pid = existing?.pid || uid();
    const sellK = sell !== null && sell > 0 ? Math.round(sell * 100) : existing?.sell || 0;
    plan.products.push({
      pid,
      name: existing?.name || name,
      category: str(c.cat) || existing?.category || 'Без категорії',
      unit: existing?.unit || unit,
      sell: sellK,
      min: min !== null ? Math.round(min * 1000) : existing?.min || 0,
      barcode: barcode || existing?.barcode,
      sku: sku || existing?.sku,
    });
    if (existing) plan.updated++;
    else plan.created++;
    if (!sellK) plan.withoutPrice++;
    const row: ImportRow = {
      row: rowNo,
      pid,
      name: existing?.name || name,
      isNew: !existing,
      unit: existing?.unit || unit,
      qty: qty !== null ? Math.round(qty * 1000) : null,
      buy: buy !== null ? Math.round(buy * 100) : null,
      sell: sellK || null,
    };
    plan.rows.push(row);
    seen.set(name.toLowerCase(), row);
    if (qty && qty > 0 && buy !== null && buy >= 0) {
      const line = { pid, qty: Math.round(qty * 1000), price: Math.round(buy * 100) };
      plan.stock.push(line);
      plan.stockValue += lineTotal(line.qty, line.price);
    }
  });
  if (dates.size === 1) plan.date = [...dates][0];
  // постачальник — рядок шапки на кшталт «Постачальник: ТОВ …»
  for (const r of all.slice(0, headIdx)) {
    const t = r.map((x) => String(x ?? '')).join(' ');
    const m = t.match(/(постачальник|поставщик)\s*:?\s*(.+)/i);
    if (m) plan.supplier = m[2].trim().slice(0, 80);
  }
  return plan;
}
