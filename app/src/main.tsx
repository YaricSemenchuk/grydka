import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/cyrillic-400.css';
import '@fontsource/ibm-plex-sans/cyrillic-500.css';
import '@fontsource/ibm-plex-sans/cyrillic-600.css';
import '@fontsource/ibm-plex-sans/cyrillic-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/cyrillic-400.css';
import '@fontsource/ibm-plex-mono/cyrillic-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles.css';
import { App } from './App';
import { store } from './core/store';

store
  .init()
  .then(() => createRoot(document.getElementById('root')!).render(<App />))
  .catch((err) => {
    document.getElementById('root')!.innerHTML =
      '<div style="padding:40px;font-family:sans-serif">Не вдалося відкрити локальну базу даних. Перезапустіть застосунок.<br><small>' +
      String(err) +
      '</small></div>';
  });
