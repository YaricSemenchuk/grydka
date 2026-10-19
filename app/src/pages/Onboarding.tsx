import { useState } from 'react';
import { isTauri, store } from '../core/store';
import { Icon, useStore } from '../ui';

/** Перший запуск: підключення до сервера магазину або робота без нього */
export function Onboarding() {
  const { settings } = useStore();
  const [mode, setMode] = useState<'server' | 'local'>('server');
  const [url, setUrl] = useState(settings.serverUrl);
  const [token, setToken] = useState(settings.token);
  const [device, setDevice] = useState(isTauri ? 'Каса' : 'Браузер');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function go() {
    setErr('');
    if (mode === 'local') {
      await store.saveSettings({ onboarded: true, device: device.trim() || 'Каса', token: '', serverUrl: '' });
      return;
    }
    if (isTauri && !url.trim()) return setErr('Вкажіть адресу сервера');
    if (!token.trim()) return setErr('Вкажіть ключ магазину');
    setBusy(true);
    const r = await store.testConnection(isTauri ? url : '', token.trim());
    setBusy(false);
    if (!r.ok) return setErr(r.error || 'Не вдалося підключитися');
    await store.saveSettings({ onboarded: true, serverUrl: isTauri ? url.trim() : '', token: token.trim(), device: device.trim() || 'Пристрій', shopName: r.shop || settings.shopName });
  }

  return (
    <div className="onb">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <div className="row" style={{ gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--side)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icon.logo(30)}</div>
          <div>
            <h2 style={{ fontSize: 22 }}>Грядка</h2>
            <div className="muted">облік надходжень і чистого прибутку</div>
          </div>
        </div>

        {isTauri && (
          <div className="choice">
            <button type="button" aria-pressed={mode === 'server'} onClick={() => setMode('server')}>
              <b>Підключити до сервера магазину</b>
              <span>Дані бачать усі пристрої: каса, Mac власника, веб-версія</span>
            </button>
            <button type="button" aria-pressed={mode === 'local'} onClick={() => setMode('local')}>
              <b>Працювати лише на цьому комп’ютері</b>
              <span>Сервер можна підключити пізніше — нічого не загубиться</span>
            </button>
          </div>
        )}

        {mode === 'server' && (
          <>
            {isTauri && (
              <label className="field">
                Адреса сервера
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://облік.ваш-домен.ua" autoComplete="off" />
              </label>
            )}
            <label className="field">
              Ключ магазину
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            </label>
          </>
        )}
        <label className="field">
          Назва цього пристрою
          <input value={device} onChange={(e) => setDevice(e.target.value)} placeholder="Каса, MacBook…" />
        </label>
        {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}
        <button className="btn primary big" type="submit" disabled={busy}>
          {busy ? 'Підключаюся…' : mode === 'server' ? 'Підключитися' : 'Почати роботу'}
        </button>
      </form>
    </div>
  );
}
