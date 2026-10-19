const intFmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 });

/** 123456 коп → «1 234,56 грн», 123400 → «1 234 грн»; whole — округлити до гривні */
export function money(kop: number, opts: { sign?: boolean; whole?: boolean } = {}): string {
  const k = opts.whole ? Math.round(kop / 100) * 100 : Math.round(kop);
  const abs = Math.abs(k);
  const body = abs % 100 === 0 ? intFmt.format(abs / 100) : decFmt.format(abs / 100);
  const sign = k < 0 ? '−' : opts.sign && k > 0 ? '+' : '';
  return `${sign}${body} грн`;
}

export function qty(milli: number): string {
  return qtyFmt.format(milli / 1000);
}

/** «12,5» / «12.50» / «1 200» → копейки, или null */
export function parseMoney(s: string): number | null {
  const n = parseNum(s);
  return n === null ? null : Math.round(n * 100);
}

/** «1,5» → 1500 milli */
export function parseQty(s: string): number | null {
  const n = parseNum(s);
  return n === null ? null : Math.round(n * 1000);
}

export function parseNum(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = s.replace(/\s| | /g, '').replace(',', '.').replace(/[₴грн.]+$/i, '');
  if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Копейки → строка для поля ввода: 4550 → «45,5» */
export function moneyInput(kop: number): string {
  return String(kop / 100).replace('.', ',');
}
export function qtyInput(milli: number): string {
  return String(milli / 1000).replace('.', ',');
}

export function lineTotal(qtyMilli: number, priceKop: number): number {
  return Math.round((qtyMilli * priceKop) / 1000);
}

const dtFmt = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const tFmt = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' });
const dFmt = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
const dShort = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' });

export const fmtDateTime = (iso: string) => dtFmt.format(new Date(iso));
export const fmtTime = (iso: string) => tFmt.format(new Date(iso));
export const fmtDate = (d: Date) => dFmt.format(d);
export const fmtDayShort = (d: Date) => dShort.format(d).replace('.', '');

export function pct(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
