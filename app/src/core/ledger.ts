import { lineTotal } from './format';
import type { AnyEnvelope, ID, Pay, Payloads, Unit } from './types';

/**
 * Состояние магазина целиком вычисляется из журнала операций (event log).
 * Операции только добавляются, поэтому журнал легко синхронизировать
 * между кассой, Маком и сервером: каждое устройство пересчитывает одно и то же.
 *
 * Себестоимость — по средней закупочной цене (средневзвешенной):
 * склад хранит количество и суммарную стоимость, продажа списывает
 * пропорциональную часть стоимости.
 */

export interface ProductState {
  pid: ID;
  name: string;
  category: string;
  unit: Unit;
  sell: number;
  min: number;
  barcode?: string;
  sku?: string;
  archived: boolean;
  known: boolean; // была ли карточка (могла прийти позже продажи при синхронизации)
  stock: number; // milli
  value: number; // стоимость остатка, коп (дробная, округляется только при списании)
  lastAvg: number; // коп за 1 ед — используется, если остаток ушёл в минус
}

export type OpKind = 'sale' | 'return' | 'purchase' | 'expense' | 'adjust';

export interface OpLine {
  pid: ID;
  name: string;
  unit: Unit;
  qty: number;
  price: number;
  total: number; // до скидки
  net: number; // выручка по строке после скидки
  cost: number; // себестоимость строки
}

export interface Op {
  id: ID;
  kind: OpKind;
  ts: string;
  device: string;
  title: string;
  amount: number; // движение денег: + в кассу, − из кассы
  revenue: number;
  cogs: number;
  expense: number;
  writeoff: number;
  pay?: Pay;
  lines: OpLine[];
  cat?: string;
  note?: string;
  discount?: number;
  voided: boolean;
  voidReason?: string;
  returnedBy?: ID; // для продажи — id возврата
  refId?: ID; // для возврата — id продажи
  supplier?: string;
}

export interface Ledger {
  products: Map<ID, ProductState>;
  productList: ProductState[]; // активные, по имени
  ops: Op[]; // новые сверху
  opById: Map<ID, Op>;
  eventCount: number;
  categories: string[]; // категории товаров, что встречаются
  expenseCats: string[];
}

export function sortEvents(events: AnyEnvelope[]): AnyEnvelope[] {
  return [...events].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function blankProduct(pid: ID): ProductState {
  return {
    pid,
    name: 'Товар (немає картки)',
    category: 'Без категорії',
    unit: 'шт',
    sell: 0,
    min: 0,
    archived: false,
    known: false,
    stock: 0,
    value: 0,
    lastAvg: 0,
  };
}

/** Поля картки товару для повторного product.upsert (щоб нічого не загубити) */
export function productPayload(p: ProductState) {
  return { pid: p.pid, name: p.name, category: p.category, unit: p.unit, sell: p.sell, min: p.min, barcode: p.barcode, sku: p.sku, archived: p.archived };
}

/** Пошук товару: назва (усі слова), штрихкод або артикул */
export function matchProduct(p: ProductState, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (p.barcode === q || (p.sku && p.sku.toLowerCase() === q)) return true;
  const hay = `${p.name} ${p.sku || ''}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** Средняя цена за 1 единицу, коп */
export function avgCost(p: ProductState): number {
  return p.stock > 0 ? (p.value * 1000) / p.stock : p.lastAvg;
}

/** Списать qty со склада, вернуть себестоимость (коп, целое) */
function takeFromStock(p: ProductState, q: number): number {
  if (q <= 0) return 0;
  let cost: number;
  if (p.stock <= 0) {
    cost = Math.round((p.lastAvg * q) / 1000);
  } else if (q >= p.stock) {
    const over = q - p.stock;
    const avg = avgCost(p);
    cost = Math.round(p.value + (avg * over) / 1000);
    p.lastAvg = avg;
    p.value = 0;
  } else {
    cost = Math.round((p.value * q) / p.stock);
    p.lastAvg = avgCost(p);
    p.value -= cost;
  }
  p.stock -= q;
  if (p.stock === 0) p.value = 0;
  return cost;
}

/** Положить qty на склад общей стоимостью costTotal (коп) */
function putToStock(p: ProductState, q: number, costTotal: number) {
  if (q <= 0) return;
  const unitCost = (costTotal * 1000) / q;
  const newStock = p.stock + q;
  if (p.stock >= 0) {
    p.value += costTotal;
  } else if (newStock > 0) {
    // часть партии закрывает «минус», который уже списан по lastAvg
    p.value = (unitCost * newStock) / 1000;
  } else {
    p.value = 0;
  }
  p.stock = newStock;
  p.lastAvg = p.stock > 0 ? (p.value * 1000) / p.stock : unitCost;
}

function validLines(items: unknown): items is Payloads['sale']['items'] {
  return (
    Array.isArray(items) &&
    items.every(
      (l) =>
        l &&
        typeof l.pid === 'string' &&
        Number.isFinite(l.qty) &&
        l.qty > 0 &&
        Number.isFinite(l.price) &&
        l.price >= 0,
    )
  );
}

export function buildLedger(events: AnyEnvelope[]): Ledger {
  const sorted = sortEvents(events);
  const products = new Map<ID, ProductState>();
  const ops: Op[] = [];
  const opById = new Map<ID, Op>();
  const getP = (pid: ID) => {
    let p = products.get(pid);
    if (!p) {
      p = blankProduct(pid);
      products.set(pid, p);
    }
    return p;
  };

  // 1) какие операции отменены (void самого void не поддерживается)
  const voided = new Map<ID, string | undefined>();
  for (const e of sorted) if (e.type === 'void' && e.p?.target) voided.set(e.p.target, e.p.reason);

  // 2) прогон по времени
  for (const e of sorted) {
    try {
      const isVoided = voided.has(e.id);
      switch (e.type) {
        case 'product.upsert': {
          const p = getP(e.p.pid);
          p.name = String(e.p.name || 'Без назви');
          p.category = e.p.category || 'Без категорії';
          p.unit = e.p.unit || 'шт';
          p.sell = Math.max(0, Math.round(e.p.sell || 0));
          p.min = Math.max(0, Math.round(e.p.min || 0));
          p.barcode = e.p.barcode || undefined;
          p.sku = e.p.sku || undefined;
          p.archived = !!e.p.archived;
          p.known = true;
          break;
        }
        case 'purchase': {
          if (!validLines(e.p.items)) break;
          const lines: OpLine[] = e.p.items.map((l) => {
            const p = getP(l.pid);
            const total = lineTotal(l.qty, l.price);
            if (!isVoided) putToStock(p, l.qty, total);
            return { pid: l.pid, name: p.name, unit: p.unit, qty: l.qty, price: l.price, total, net: total, cost: total };
          });
          const sum = lines.reduce((s, l) => s + l.total, 0);
          push({
            id: e.id,
            kind: 'purchase',
            ts: e.ts,
            device: e.device,
            title: e.p.supplier ? `Закупівля · ${e.p.supplier}` : 'Надходження товару',
            amount: -sum,
            revenue: 0,
            cogs: 0,
            expense: 0,
            writeoff: 0,
            pay: e.p.pay,
            lines,
            note: e.p.note,
            supplier: e.p.supplier,
            voided: isVoided,
            voidReason: voided.get(e.id),
          });
          break;
        }
        case 'sale': {
          if (!validLines(e.p.items) || !e.p.items.length) break;
          const totals = e.p.items.map((l) => lineTotal(l.qty, l.price));
          const gross = totals.reduce((s, t) => s + t, 0);
          const discount = Math.min(Math.max(0, Math.round(e.p.discount || 0)), gross);
          let left = discount;
          const lines: OpLine[] = e.p.items.map((l, i) => {
            const p = getP(l.pid);
            const share = i === totals.length - 1 ? left : gross ? Math.round((discount * totals[i]) / gross) : 0;
            left -= share;
            const cost = isVoided ? 0 : takeFromStock(p, l.qty);
            return { pid: l.pid, name: p.name, unit: p.unit, qty: l.qty, price: l.price, total: totals[i], net: totals[i] - share, cost };
          });
          const revenue = gross - discount;
          const cogs = lines.reduce((s, l) => s + l.cost, 0);
          push({
            id: e.id,
            kind: 'sale',
            ts: e.ts,
            device: e.device,
            title: saleTitle(lines),
            amount: revenue,
            revenue,
            cogs,
            expense: 0,
            writeoff: 0,
            pay: e.p.pay,
            lines,
            discount,
            note: e.p.note,
            voided: isVoided,
            voidReason: voided.get(e.id),
          });
          break;
        }
        case 'sale.return': {
          const sale = opById.get(e.p.saleId);
          if (!sale || sale.kind !== 'sale' || sale.voided) break;
          if (sale.returnedBy && !opById.get(sale.returnedBy)?.voided) break; // уже возвращена
          if (!isVoided) {
            sale.returnedBy = e.id;
            for (const l of sale.lines) putToStock(getP(l.pid), l.qty, l.cost);
          }
          const lines = sale.lines.map((l) => ({ ...l, qty: -l.qty, total: -l.total, net: -l.net, cost: -l.cost }));
          push({
            id: e.id,
            kind: 'return',
            ts: e.ts,
            device: e.device,
            title: `Повернення · ${sale.title}`,
            amount: -sale.revenue,
            revenue: -sale.revenue,
            cogs: -sale.cogs,
            expense: 0,
            writeoff: 0,
            pay: sale.pay,
            lines,
            note: e.p.note,
            refId: sale.id,
            voided: isVoided,
            voidReason: voided.get(e.id),
          });
          break;
        }
        case 'expense': {
          const amount = Math.round(e.p.amount);
          if (!Number.isFinite(amount) || amount <= 0) break;
          push({
            id: e.id,
            kind: 'expense',
            ts: e.ts,
            device: e.device,
            title: `Витрата · ${e.p.cat}`,
            amount: -amount,
            revenue: 0,
            cogs: 0,
            expense: amount,
            writeoff: 0,
            pay: e.p.pay,
            lines: [],
            cat: e.p.cat || 'Інше',
            note: e.p.note,
            voided: isVoided,
            voidReason: voided.get(e.id),
          });
          break;
        }
        case 'stock.adjust': {
          const q = Math.round(e.p.qty);
          if (!q) break;
          const p = getP(e.p.pid);
          let cost = 0;
          if (!isVoided) {
            if (q < 0) cost = takeFromStock(p, -q);
            else {
              cost = -Math.round((avgCost(p) * q) / 1000);
              putToStock(p, q, -cost);
            }
          }
          push({
            id: e.id,
            kind: 'adjust',
            ts: e.ts,
            device: e.device,
            title: `${q < 0 ? 'Списання' : 'Оприбуткування'} · ${p.name}`,
            amount: 0,
            revenue: 0,
            cogs: 0,
            expense: 0,
            writeoff: cost, // + убыток от списания, − излишек
            lines: [{ pid: p.pid, name: p.name, unit: p.unit, qty: q, price: 0, total: 0, net: 0, cost }],
            note: e.p.reason,
            voided: isVoided,
            voidReason: voided.get(e.id),
          });
          break;
        }
      }
    } catch {
      // повреждённая операция не должна ломать весь учёт
    }
  }

  function push(op: Op) {
    ops.push(op);
    opById.set(op.id, op);
  }

  // имена в строках — актуальные
  for (const op of ops) for (const l of op.lines) {
    const p = products.get(l.pid);
    if (p) l.name = p.name;
  }
  for (const op of ops) if (op.kind === 'sale') op.title = saleTitle(op.lines);

  ops.reverse();
  const productList = [...products.values()].filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  const categories = [...new Set(productList.map((p) => p.category))].sort((a, b) => a.localeCompare(b, 'uk'));
  const expenseCats = [...new Set(ops.filter((o) => o.kind === 'expense').map((o) => o.cat!))];
  return { products, productList, ops, opById, eventCount: events.length, categories, expenseCats };
}

function saleTitle(lines: OpLine[]): string {
  if (lines.length === 1) return lines[0].name;
  const first = lines[0].name.split(/[«,(]/)[0].trim();
  return `${first} та ще ${lines.length - 1} поз.`;
}

/* ---------------- Отчёты ---------------- */

export interface DayRow {
  date: Date;
  revenue: number;
  profit: number;
  checks: number;
}

export interface Report {
  from: Date;
  to: Date;
  revenue: number;
  cogs: number;
  gross: number;
  expenses: number;
  writeoffs: number;
  net: number;
  checks: number;
  returns: number;
  avgCheck: number;
  purchases: number;
  byCat: { cat: string; amount: number }[];
  byDay: DayRow[];
  top: { pid: ID; name: string; unit: Unit; qty: number; revenue: number; profit: number }[];
  byPay: Record<Pay, number>;
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function buildReport(ledger: Ledger, from: Date, to: Date): Report {
  const f = from.toISOString();
  const t = to.toISOString();
  const r: Report = {
    from,
    to,
    revenue: 0,
    cogs: 0,
    gross: 0,
    expenses: 0,
    writeoffs: 0,
    net: 0,
    checks: 0,
    returns: 0,
    avgCheck: 0,
    purchases: 0,
    byCat: [],
    byDay: [],
    top: [],
    byPay: { cash: 0, card: 0, bank: 0 },
  };
  const days = new Map<string, DayRow>();
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d < to; d.setDate(d.getDate() + 1)) {
    const day = new Date(d);
    days.set(dayKey(day), { date: day, revenue: 0, profit: 0, checks: 0 });
  }
  const cats = new Map<string, number>();
  const top = new Map<ID, Report['top'][number]>();

  for (const op of ledger.ops) {
    if (op.voided || op.ts < f || op.ts >= t) continue;
    const day = days.get(dayKey(new Date(op.ts)));
    const profit = op.revenue - op.cogs - op.expense - op.writeoff;
    r.revenue += op.revenue;
    r.cogs += op.cogs;
    r.expenses += op.expense;
    r.writeoffs += op.writeoff;
    if (op.pay && op.kind !== 'purchase') r.byPay[op.pay] += op.amount;
    if (op.kind === 'sale') r.checks++;
    if (op.kind === 'return') r.returns++;
    if (op.kind === 'purchase') r.purchases += -op.amount;
    if (op.kind === 'expense') cats.set(op.cat!, (cats.get(op.cat!) || 0) + op.expense);
    if (day) {
      day.revenue += op.revenue;
      day.profit += profit;
      if (op.kind === 'sale') day.checks++;
    }
    if (op.kind === 'sale' || op.kind === 'return') {
      for (const l of op.lines) {
        const row = top.get(l.pid) || { pid: l.pid, name: l.name, unit: l.unit, qty: 0, revenue: 0, profit: 0 };
        row.qty += l.qty;
        row.revenue += l.net;
        row.profit += l.net - l.cost;
        top.set(l.pid, row);
      }
    }
  }
  r.gross = r.revenue - r.cogs;
  r.net = r.gross - r.expenses - r.writeoffs;
  r.avgCheck = r.checks ? Math.round((r.revenue + 0) / r.checks) : 0;
  r.byCat = [...cats.entries()].map(([cat, amount]) => ({ cat, amount })).sort((a, b) => b.amount - a.amount);
  r.byDay = [...days.values()];
  r.top = [...top.values()].filter((x) => x.qty !== 0 || x.revenue !== 0).sort((a, b) => b.profit - a.profit);
  return r;
}

export type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'custom';

export function periodRange(kind: PeriodKind, now = new Date(), custom?: { from: string; to: string }): { from: Date; to: Date } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (kind) {
    case 'day':
      return { from: new Date(y, m, d), to: new Date(y, m, d + 1) };
    case 'week': {
      const dow = (now.getDay() + 6) % 7; // пн = 0
      return { from: new Date(y, m, d - dow), to: new Date(y, m, d - dow + 7) };
    }
    case 'month':
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1) };
    case 'year':
      return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) };
    case 'custom': {
      const [fy, fm, fd] = (custom?.from || dayKey(now)).split('-').map(Number);
      const [ty, tm, td] = (custom?.to || dayKey(now)).split('-').map(Number);
      return { from: new Date(fy, fm - 1, fd), to: new Date(ty, tm - 1, td + 1) };
    }
  }
}

/** Ограничить конец периода «сегодня» для графиков */
export function clampToToday(range: { from: Date; to: Date }, now = new Date()) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { from: range.from, to: range.to > tomorrow ? tomorrow : range.to };
}
