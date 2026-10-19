import { isTauri } from './core/store';

/** Зберегти файл: у застосунку — системне вікно «Зберегти як», у браузері — завантаження */
export async function saveFile(name: string, data: Uint8Array | string, mime: string): Promise<boolean> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const ext = name.split('.').pop() || '';
    const path = await save({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
    if (!path) return false;
    await invoke('save_file', { path, bytes: Array.from(bytes) });
    return true;
  }
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

/** Відкрити файл (працює і в браузері, і в застосунку) */
export function pickFile(accept: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
