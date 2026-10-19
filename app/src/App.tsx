import { useEffect, useState } from 'react';
import { fmtTime } from './core/format';
import { Icon, ToastProvider, useStore } from './ui';
import { Summary } from './pages/Summary';
import { Operations } from './pages/Operations';
import { Products } from './pages/Products';
import { Expenses } from './pages/Expenses';
import { Reports } from './pages/Reports';
import { STATUS_TEXT, Sync } from './pages/Sync';
import { Onboarding } from './pages/Onboarding';

export type Page = 'summary' | 'ops' | 'products' | 'expenses' | 'reports' | 'sync';
export type Go = (page: Page, opts?: { focusSale?: boolean; newExpense?: boolean; lowOnly?: boolean }) => void;

const NAV: [Page, string, () => JSX.Element, string?][] = [
  ['summary', 'Зведення', Icon.summary],
  ['ops', 'Операції', Icon.ops, 'F2'],
  ['products', 'Товари й залишки', Icon.box],
  ['expenses', 'Витрати', Icon.wallet, 'F3'],
  ['reports', 'Звіти', Icon.chart],
  ['sync', 'Синхронізація', Icon.sync],
];

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const { ready, settings, sync } = useStore();
  const [page, setPage] = useState<Page>('summary');
  const [nonce, setNonce] = useState({ sale: 0, expense: 0, purchase: 0 });
  const [lowOnly, setLowOnly] = useState(false);

  const go: Go = (p, opts = {}) => {
    setPage(p);
    setLowOnly(!!opts.lowOnly);
    if (opts.focusSale) setNonce((n) => ({ ...n, sale: n.sale + 1 }));
    if (opts.newExpense) setNonce((n) => ({ ...n, expense: n.expense + 1 }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.overlay')) return;
      if (e.key === 'F2') {
        e.preventDefault();
        go('ops', { focusSale: true });
      } else if (e.key === 'F3') {
        e.preventDefault();
        go('expenses', { newExpense: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  if (!ready) return null;
  if (!settings.onboarded) return <Onboarding />;

  const [label, color] = STATUS_TEXT[sync.status] || STATUS_TEXT.off;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          {Icon.logo()}
          <div>
            <b>Грядка</b>
            <span>{settings.shopName}</span>
          </div>
        </div>
        <nav className="nav" aria-label="Розділи">
          {NAV.map(([p, title, icon, kbd]) => (
            <button key={p} aria-current={page === p ? 'page' : undefined} onClick={() => go(p, p === 'ops' ? { focusSale: true } : p === 'expenses' ? { newExpense: true } : {})}>
              {icon()}
              {title}
              {kbd && <span className="kbd">{kbd}</span>}
            </button>
          ))}
        </nav>
        <button className="syncbox" onClick={() => go('sync')}>
          <div className="st">
            <span className="dot" style={{ background: color }} />
            {label}
          </div>
          <div>
            {sync.status === 'off'
              ? 'дані лише на цьому пристрої'
              : sync.pending
                ? `очікують відправки: ${sync.pending}`
                : sync.lastOk
                  ? `${fmtTime(sync.lastOk)} · усі дані на сервері`
                  : 'сервер магазину'}
          </div>
          <div>Пристрій: {settings.device}</div>
        </button>
      </aside>
      <main className="main">
        {page === 'summary' && <Summary go={go} />}
        {page === 'ops' && <Operations focusNonce={nonce.sale} />}
        {page === 'products' && <Products lowOnly={lowOnly} purchaseNonce={nonce.purchase} />}
        {page === 'expenses' && <Expenses focusNonce={nonce.expense} />}
        {page === 'reports' && <Reports />}
        {page === 'sync' && <Sync />}
      </main>
    </div>
  );
}
