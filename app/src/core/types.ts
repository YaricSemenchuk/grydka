// Все суммы — в копейках (целые), количество — в тысячных долях единицы (qty 1 шт = 1000).
// Это исключает ошибки округления float при сложении денег.

export type ID = string;
export type Pay = 'cash' | 'card' | 'bank';
export const UNITS = ['шт', 'уп', 'кг', 'г', 'л', 'фл', 'компл', 'наб'] as const;
export type Unit = (typeof UNITS)[number];

/** Одиниці з накладних постачальників → наші */
export function normalizeUnit(raw: string, fallback: Unit = 'шт'): Unit {
  const u = raw.trim().toLowerCase().replace(/[.\s-]+/g, '');
  if (!u) return fallback;
  if ((UNITS as readonly string[]).includes(u)) return u as Unit;
  if (u.startsWith('упак') || u === 'пак' || u === 'пачка') return 'уп';
  if (u.startsWith('флак')) return 'фл';
  if (u.startsWith('компл')) return 'компл';
  if (u.startsWith('наб')) return 'наб';
  if (u.startsWith('кілог') || u.startsWith('килог')) return 'кг';
  if (u.startsWith('літр') || u.startsWith('литр')) return 'л';
  if (u.startsWith('грам')) return 'г';
  return 'шт'; // шприц-туба, пакет, штука тощо
}

export interface Line {
  pid: ID;
  qty: number; // milli-units
  price: number; // kopecks per 1 unit
}

export interface Payloads {
  'product.upsert': {
    pid: ID;
    name: string;
    category: string;
    unit: Unit;
    sell: number; // kopecks
    min: number; // milli-units, порог «заканчивается»
    barcode?: string;
    sku?: string; // артикул / код постачальника
    archived?: boolean;
  };
  purchase: { supplier?: string; note?: string; pay?: Pay; items: Line[] };
  sale: { items: Line[]; pay: Pay; discount?: number; note?: string };
  'sale.return': { saleId: ID; note?: string };
  expense: { cat: string; amount: number; pay: Pay; note?: string };
  'stock.adjust': { pid: ID; qty: number; reason: string };
  void: { target: ID; reason?: string };
}

export type EventType = keyof Payloads;

export interface Envelope<T extends EventType = EventType> {
  id: ID;
  type: T;
  ts: string; // ISO UTC — когда операция произошла
  device: string;
  p: Payloads[T];
  seq?: number; // порядковый номер на сервере
}

export type AnyEnvelope = { [K in EventType]: Envelope<K> }[EventType];

export const EXPENSE_CATEGORIES = [
  'Оренда',
  'Зарплата',
  'Реклама',
  'Комунальні',
  'Пакування',
  'Доставка',
  'Податки',
  'Інше',
];

export const PRODUCT_CATEGORIES = [
  'Овочі',
  'Квіти',
  'Зелень',
  'Газон',
  'Сіянка й цибулини',
  'Добрива',
  'Інвентар',
];

export const PAY_LABEL: Record<Pay, string> = { cash: 'Готівка', card: 'Картка', bank: 'Безготівка' };
