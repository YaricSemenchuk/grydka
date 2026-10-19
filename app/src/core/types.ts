// Все суммы — в копейках (целые), количество — в тысячных долях единицы (qty 1 шт = 1000).
// Это исключает ошибки округления float при сложении денег.

export type ID = string;
export type Pay = 'cash' | 'card' | 'bank';
export type Unit = 'шт' | 'уп' | 'кг' | 'г' | 'л';

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
