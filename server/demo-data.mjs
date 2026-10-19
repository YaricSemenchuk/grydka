// Заповнює сервер демонстраційними даними — щоб показати застосунок замовнику.
// Використання:  node demo-data.mjs http://localhost:8787 КЛЮЧ_МАГАЗИНУ
// Увага: дані додаються до наявних. Для показу використовуйте окремий тестовий сервер.

import crypto from 'node:crypto';

const [, , url = 'http://localhost:8787', key] = process.argv;
if (!key) {
  console.error('Використання: node demo-data.mjs <адреса сервера> <ключ магазину>');
  process.exit(1);
}

let seed = 20261019;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const id = () => crypto.randomUUID();

// [назва, категорія, од., закупівля грн, продаж грн, мін. залишок]
const PRODUCTS = [
  ['Томат «Бичаче серце», 0,1 г', 'Овочі', 'шт', 25, 45, 20],
  ['Томат «Де Барао рожевий», 0,1 г', 'Овочі', 'шт', 22, 40, 20],
  ['Огірок «Конкурент», 0,5 г', 'Овочі', 'шт', 22, 38, 20],
  ['Огірок «Ніжинський», 0,5 г', 'Овочі', 'шт', 20, 36, 20],
  ['Перець «Каліфорнійське диво», 0,3 г', 'Овочі', 'шт', 24, 44, 15],
  ['Редис «Французький сніданок», 3 г', 'Овочі', 'шт', 12, 24, 15],
  ['Морква «Нантська», 2 г', 'Овочі', 'шт', 11, 22, 15],
  ['Кріп «Алігатор», 3 г', 'Зелень', 'шт', 10, 20, 15],
  ['Петрушка листова, 3 г', 'Зелень', 'шт', 10, 20, 15],
  ['Петунія ампельна, мікс', 'Квіти', 'шт', 21, 42, 15],
  ['Чорнобривці низькорослі', 'Квіти', 'шт', 14, 28, 15],
  ['Айстра півонієвидна', 'Квіти', 'шт', 15, 30, 10],
  ['Газонна суміш «Спорт», 1 кг', 'Газон', 'уп', 140, 290, 5],
  ['Газонна суміш «Тіньова», 1 кг', 'Газон', 'уп', 150, 310, 5],
  ['Цибуля-сіянка «Штутгартер»', 'Сіянка й цибулини', 'кг', 100, 150, 10],
  ['Часник озимий «Любаша»', 'Сіянка й цибулини', 'кг', 180, 260, 5],
  ['Добриво «Осіннє», 1 кг', 'Добрива', 'уп', 85, 130, 5],
  ['Добриво для газону, 1 кг', 'Добрива', 'уп', 95, 150, 5],
];

const events = [];
const ev = (type, p, ts, device) => events.push({ id: id(), type, ts: ts.toISOString(), device, p });

const now = new Date();
const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 8, 30);
const prods = PRODUCTS.map(([name, category, unit, buy, sell, min]) => ({
  pid: id(),
  name,
  category,
  unit,
  buy: buy * 100,
  sell: sell * 100,
  min: min * 1000,
  barcode: '482' + String(Math.floor(rnd() * 1e10)).padStart(10, '0'),
}));
for (const p of prods) ev('product.upsert', { pid: p.pid, name: p.name, category: p.category, unit: p.unit, sell: p.sell, min: p.min, barcode: p.barcode }, start, 'MacBook власника');

// закупівлі: кількість підбирається після генерації продажів, щоб склад не пішов у мінус;
// кілька товарів закуплено впритул — щоб у демо було видно попередження «закінчується»
const SCARCE = new Map([[5, 4], [7, 6], [16, 2]]); // індекс товару → залишок наприкінці
const p1 = { supplier: 'Агронасіння', pay: 'bank', items: [] };
const p2 = { supplier: 'Агронасіння', pay: 'bank', items: [] };
ev('purchase', p1, new Date(start.getTime() + 10 * 60000), 'MacBook власника');
ev('purchase', p2, new Date(now.getFullYear(), now.getMonth(), 2, 10, 15), 'MacBook власника');

for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = day.getDay();
  const isToday = day.toDateString() === now.toDateString();
  // витрати
  const exp = (dom, cat, amount, note) => day.getDate() === dom && ev('expense', { cat, amount: amount * 100, pay: cat === 'Зарплата' ? 'cash' : 'bank', note }, new Date(day.getTime() + 11 * 3600e3), 'MacBook власника');
  exp(1, 'Оренда', 14000, 'Оренда приміщення');
  exp(5, 'Реклама', 2800, 'Таргет у соцмережах');
  exp(10, 'Комунальні', 1900, 'Світло, вода');
  exp(12, 'Пакування', 900, 'Пакети, скотч');
  exp(15, 'Зарплата', 12000, 'Продавець');
  // продажі
  const checks = Math.round((dow === 0 ? 18 : dow === 6 ? 50 : 34) * (0.75 + rnd() * 0.5));
  const lastHour = isToday ? Math.min(18, now.getHours() - 0.2) : 18;
  if (lastHour <= 9) continue;
  for (let c = 0; c < checks; c++) {
    const ts = new Date(day.getTime() + (9 + rnd() * (lastHour - 9)) * 3600e3);
    const n = 1 + Math.floor(rnd() * rnd() * 4);
    const items = [];
    for (let i = 0; i < n; i++) {
      const p = pick(prods);
      if (items.some((x) => x.pid === p.pid)) continue;
      const q = p.unit === 'кг' ? pick([500, 1000, 1000, 2000]) : 1000 * (1 + Math.floor(rnd() * rnd() * 3));
      items.push({ pid: p.pid, qty: q, price: p.sell });
    }
    ev('sale', { items, pay: rnd() < 0.55 ? 'cash' : 'card' }, ts, 'Каса');
  }
}
const sold = new Map(prods.map((p) => [p.pid, 0]));
for (const e of events) if (e.type === 'sale') for (const l of e.p.items) sold.set(l.pid, sold.get(l.pid) + l.qty);
prods.forEach((p, i) => {
  const S = sold.get(p.pid) + (i === 9 ? 3000 : 0); // + списання петунії
  const unit = 1000;
  if (SCARCE.has(i)) {
    p1.items.push({ pid: p.pid, qty: S + SCARCE.get(i) * unit, price: p.buy });
  } else {
    const first = Math.ceil((S * 0.8) / unit) * unit + 10 * unit;
    const rest = Math.max(0, S - first) + Math.round(20 + rnd() * 40) * unit;
    p1.items.push({ pid: p.pid, qty: first, price: p.buy });
    p2.items.push({ pid: p.pid, qty: rest, price: p.buy + 100 });
  }
});

// трохи повернень і списань
const sales = events.filter((e) => e.type === 'sale');
for (const s of [sales[37], sales[211]].filter(Boolean)) ev('sale.return', { saleId: s.id, note: 'Брак пакування' }, new Date(Date.parse(s.ts) + 3600e3), 'Каса');
ev('stock.adjust', { pid: prods[9].pid, qty: -3000, reason: 'Зіпсовано' }, new Date(now.getFullYear(), now.getMonth(), 3, 17, 0), 'Каса');

const res = await fetch(url.replace(/\/+$/, '') + '/api/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ cursor: 1e12, events }),
});
if (!res.ok) {
  console.error('Помилка сервера:', res.status);
  process.exit(1);
}
console.log(`Додано демонстраційних операцій: ${events.length}`);
