import { describe, expect, it } from 'vitest';
import { buildLedger, buildReport } from './ledger';
import type { AnyEnvelope } from './types';

let n = 0;
const ev = (type: AnyEnvelope['type'], p: any, ts: string, id?: string): AnyEnvelope =>
  ({ id: id || `e${++n}`, type, ts, device: 't', p }) as AnyEnvelope;

const tomato = ev('product.upsert', { pid: 't', name: 'Томат', category: 'Овощи', unit: 'шт', sell: 4500, min: 10000 }, '2026-10-01T08:00:00Z');

describe('ledger', () => {
  it('считает выручку, себестоимость по средней и чистую прибыль', () => {
    const events = [
      tomato,
      ev('purchase', { items: [{ pid: 't', qty: 10000, price: 2000 }] }, '2026-10-01T09:00:00Z'), // 10 × 20 ₴
      ev('purchase', { items: [{ pid: 't', qty: 10000, price: 3000 }] }, '2026-10-02T09:00:00Z'), // 10 × 30 ₴ → средняя 25
      ev('sale', { items: [{ pid: 't', qty: 4000, price: 4500 }], pay: 'cash' }, '2026-10-03T10:00:00Z'), // 180 ₴, себ 100
      ev('expense', { cat: 'Аренда', amount: 5000, pay: 'cash' }, '2026-10-03T11:00:00Z'),
    ];
    const L = buildLedger(events);
    const t = L.products.get('t')!;
    expect(t.stock).toBe(16000);
    expect(Math.round(t.value)).toBe(40000);
    const r = buildReport(L, new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
    expect(r.revenue).toBe(18000);
    expect(r.cogs).toBe(10000);
    expect(r.gross).toBe(8000);
    expect(r.expenses).toBe(5000);
    expect(r.net).toBe(3000);
    expect(r.purchases).toBe(50000);
    expect(r.checks).toBe(1);
  });

  it('скидка распределяется по строкам, итог точный', () => {
    const cuc = ev('product.upsert', { pid: 'c', name: 'Огурец', category: 'Овощи', unit: 'шт', sell: 3800, min: 0 }, '2026-10-01T08:00:00Z');
    const L = buildLedger([
      tomato,
      cuc,
      ev('purchase', { items: [{ pid: 't', qty: 5000, price: 2500 }, { pid: 'c', qty: 5000, price: 2200 }] }, '2026-10-01T09:00:00Z'),
      ev('sale', { items: [{ pid: 't', qty: 4000, price: 4500 }, { pid: 'c', qty: 2000, price: 3800 }], pay: 'card', discount: 1000 }, '2026-10-02T09:00:00Z'),
    ]);
    const sale = L.ops.find((o) => o.kind === 'sale')!;
    expect(sale.revenue).toBe(25600 - 1000);
    expect(sale.lines.reduce((s, l) => s + l.net, 0)).toBe(24600);
    expect(sale.cogs).toBe(10000 + 4400);
  });

  it('возврат восстанавливает склад и уменьшает выручку в день возврата', () => {
    const L = buildLedger([
      tomato,
      ev('purchase', { items: [{ pid: 't', qty: 10000, price: 2000 }] }, '2026-10-01T09:00:00Z'),
      ev('sale', { items: [{ pid: 't', qty: 2000, price: 4500 }], pay: 'cash' }, '2026-10-02T09:00:00Z', 's1'),
      ev('sale.return', { saleId: 's1' }, '2026-10-05T09:00:00Z'),
      ev('sale.return', { saleId: 's1' }, '2026-10-06T09:00:00Z'), // повторный — игнор
    ]);
    expect(L.products.get('t')!.stock).toBe(10000);
    expect(Math.round(L.products.get('t')!.value)).toBe(20000);
    const r = buildReport(L, new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
    expect(r.revenue).toBe(0);
    expect(r.net).toBe(0);
    expect(L.ops.filter((o) => o.kind === 'return')).toHaveLength(1);
  });

  it('отмена (void) убирает операцию из учёта и склада', () => {
    const L = buildLedger([
      tomato,
      ev('purchase', { items: [{ pid: 't', qty: 10000, price: 2000 }] }, '2026-10-01T09:00:00Z', 'p1'),
      ev('void', { target: 'p1', reason: 'ошибка' }, '2026-10-01T10:00:00Z'),
    ]);
    expect(L.products.get('t')!.stock).toBe(0);
    expect(L.opById.get('p1')!.voided).toBe(true);
  });

  it('продажа в минус и последующая закупка не ломают стоимость', () => {
    const L = buildLedger([
      tomato,
      ev('purchase', { items: [{ pid: 't', qty: 2000, price: 2000 }] }, '2026-10-01T09:00:00Z'),
      ev('sale', { items: [{ pid: 't', qty: 3000, price: 4500 }], pay: 'cash' }, '2026-10-02T09:00:00Z'),
      ev('purchase', { items: [{ pid: 't', qty: 5000, price: 3000 }] }, '2026-10-03T09:00:00Z'),
    ]);
    const t = L.products.get('t')!;
    const sale = L.ops.find((o) => o.kind === 'sale')!;
    expect(sale.cogs).toBe(6000); // 2 по 20 + 1 по средней 20
    expect(t.stock).toBe(4000);
    expect(Math.round(t.value)).toBe(12000); // 4 по 30
  });

  it('списание идёт в убыток по средней себестоимости', () => {
    const L = buildLedger([
      tomato,
      ev('purchase', { items: [{ pid: 't', qty: 10000, price: 2000 }] }, '2026-10-01T09:00:00Z'),
      ev('stock.adjust', { pid: 't', qty: -3000, reason: 'Брак' }, '2026-10-02T09:00:00Z'),
    ]);
    const r = buildReport(L, new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
    expect(r.writeoffs).toBe(6000);
    expect(r.net).toBe(-6000);
    expect(L.products.get('t')!.stock).toBe(7000);
  });

  it('порядок прихода событий не важен — результат одинаковый', () => {
    const events = [
      tomato,
      ev('purchase', { items: [{ pid: 't', qty: 10000, price: 2000 }] }, '2026-10-01T09:00:00Z'),
      ev('sale', { items: [{ pid: 't', qty: 4000, price: 4500 }], pay: 'cash' }, '2026-10-03T10:00:00Z'),
      ev('purchase', { items: [{ pid: 't', qty: 10000, price: 3000 }] }, '2026-10-02T09:00:00Z'),
    ];
    const a = buildLedger(events);
    const b = buildLedger([...events].reverse());
    expect(a.products.get('t')).toEqual(b.products.get('t'));
    expect(a.ops.map((o) => o.cogs)).toEqual(b.ops.map((o) => o.cogs));
  });
});
