import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { store } from './core/store';
import { periodRange, type PeriodKind } from './core/ledger';

export function useStore() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/* ---------- иконки (лінійні SVG) ---------- */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
export const Icon = {
  logo: (s = 28) => (
    <svg width={s} height={s} viewBox="0 0 24 24" {...P} stroke="#8FD19E" aria-hidden="true">
      <path d="M12 21v-9" />
      <path d="M12 12c0-4 3-7 8-7 0 5-3 7-8 7z" />
      <path d="M12 14c0-3-2.5-5.5-7-5.5 0 4 2.5 5.5 7 5.5z" />
    </svg>
  ),
  summary: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P} aria-hidden="true">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  ops: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P} aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  ),
  box: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P} aria-hidden="true">
      <path d="M4 8l8-4 8 4-8 4-8-4z" />
      <path d="M4 8v8l8 4 8-4V8" />
    </svg>
  ),
  wallet: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P} aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
    </svg>
  ),
  chart: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P} aria-hidden="true">
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </svg>
  ),
  sync: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P} aria-hidden="true">
      <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" />
      <path d="M18 3v4h-4M6 21v-4h4" />
    </svg>
  ),
  search: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  ),
  edit: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    </svg>
  ),
  warn: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true">
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v5M12 18v.5" />
    </svg>
  ),
  close: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  scale: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true">
      <path d="M4 7h16M7 7l-3 7h6L7 7zM17 7l-3 7h6l-3-7zM12 4v16M8 20h8" />
    </svg>
  ),
};

/* ---------- модальне вікно ---------- */
export function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-x)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal${props.wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title} ref={ref}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="iconbtn modal-x" onClick={props.onClose} aria-label="Закрити">
            {Icon.close()}
          </button>
        </div>
        {props.children}
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

/* ---------- сповіщення ---------- */
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: 'ok' | 'err'; n: number } | null>(null);
  const show = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => setT({ msg, kind, n: Date.now() }), []);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => setT(null), t.kind === 'err' ? 6000 : 3000);
    return () => clearTimeout(id);
  }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div className={`toast${t.kind === 'err' ? ' err' : ''}`} role="status" aria-live="polite">
          {t.msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- вибір періоду ---------- */
export interface PeriodValue {
  kind: PeriodKind;
  from: string;
  to: string;
}
const PERIOD_LABELS: [PeriodKind, string][] = [
  ['day', 'День'],
  ['week', 'Тиждень'],
  ['month', 'Місяць'],
  ['year', 'Рік'],
  ['custom', 'Період…'],
];
export function PeriodPicker({ value, onChange, allowCustom = true }: { value: PeriodValue; onChange: (v: PeriodValue) => void; allowCustom?: boolean }) {
  return (
    <div className="row">
      <div className="seg" role="group" aria-label="Період">
        {PERIOD_LABELS.filter(([k]) => allowCustom || k !== 'custom').map(([k, label]) => (
          <button key={k} aria-pressed={value.kind === k} onClick={() => onChange({ ...value, kind: k })}>
            {label}
          </button>
        ))}
      </div>
      {value.kind === 'custom' && (
        <>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">з</span>
            <input className="input" type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} style={{ width: 160 }} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">по</span>
            <input className="input" type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} style={{ width: 160 }} />
          </label>
        </>
      )}
    </div>
  );
}

export function usePeriod(initial: PeriodKind = 'month') {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [value, setValue] = useState<PeriodValue>({ kind: initial, from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) });
  const range = periodRange(value.kind, new Date(), { from: value.from, to: value.to });
  return { value, setValue, range };
}

const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const MONTHS_NOM = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];

export function periodTitle(v: PeriodValue, range: { from: Date; to: Date }): string {
  const f = range.from;
  const last = new Date(range.to.getTime() - 1);
  switch (v.kind) {
    case 'day':
      return `сьогодні, ${f.getDate()} ${MONTHS_GEN[f.getMonth()]}`;
    case 'week':
      return `тиждень ${f.getDate()} ${MONTHS_GEN[f.getMonth()]} — ${last.getDate()} ${MONTHS_GEN[last.getMonth()]}`;
    case 'month':
      return `${MONTHS_NOM[f.getMonth()]} ${f.getFullYear()}`;
    case 'year':
      return `${f.getFullYear()} рік`;
    default:
      return `${f.getDate()} ${MONTHS_GEN[f.getMonth()]} ${f.getFullYear()} — ${last.getDate()} ${MONTHS_GEN[last.getMonth()]} ${last.getFullYear()}`;
  }
}

/** Підтвердження без системного confirm() — він погано виглядає в застосунку */
export function Confirm(props: { title: string; text: ReactNode; ok: string; danger?: boolean; onOk: () => void; onClose: () => void; children?: ReactNode }) {
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Скасувати
          </button>
          <button
            className={`btn ${props.danger ? 'danger' : 'primary'}`}
            onClick={() => {
              props.onOk();
              props.onClose();
            }}
          >
            {props.ok}
          </button>
        </>
      }
    >
      <div style={{ lineHeight: 1.55 }}>{props.text}</div>
      {props.children}
    </Modal>
  );
}
