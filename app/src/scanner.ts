import { useEffect, useRef } from 'react';

/**
 * Сканер штрихкодів працює як клавіатура: дуже швидко «друкує» цифри й натискає Enter.
 * Ловимо таку серію на рівні всього вікна — хоч би де стояв курсор:
 *  - людина друкує ~100+ мс на символ, сканер — 5–30 мс;
 *  - надруковані сканером символи прибираємо з поля, куди вони випадково потрапили;
 *  - Enter від сканера не доходить до форм (не проведе продаж і не збереже картку).
 */
const MAX_GAP = 60; // мс між символами всередині скану
const MAX_AVG = 40; // середній інтервал, щоб вважати серію сканом
const MIN_LEN = 4;

const valueSetter = (el: HTMLInputElement | HTMLTextAreaElement) =>
  Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!;

export function useScanner(onScan: (code: string) => void) {
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    let buf = '';
    let first = 0;
    let last = 0;
    // поле й значення до початку серії — щоб відновити, навіть якщо текст у полі був виділений
    let field: HTMLInputElement | HTMLTextAreaElement | null = null;
    let before = '';

    const onKey = (e: KeyboardEvent) => {
      const now = performance.now();
      if (e.key === 'Enter') {
        const avg = buf.length ? (now - first) / buf.length : Infinity;
        if (buf.length >= MIN_LEN && now - last < MAX_GAP * 2 && avg < MAX_AVG) {
          e.preventDefault();
          e.stopPropagation();
          const code = buf;
          // прибрати код з поля, куди його надрукував сканер
          const el = document.activeElement;
          if (field && el === field && field.value !== before) {
            valueSetter(field).call(field, before);
            field.dispatchEvent(new Event('input', { bubbles: true }));
          }
          buf = '';
          cb.current(code);
          return;
        }
        buf = '';
        return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      if (now - last > MAX_GAP) {
        buf = '';
        first = now;
        const el = document.activeElement;
        field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
        before = field ? field.value : '';
      }
      buf += e.key;
      last = now;
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

/** Короткий сигнал: успіх — високий тон, не знайдено — два низьких */
let ctx: AudioContext | null = null;
export function beep(ok: boolean) {
  try {
    ctx = ctx || new AudioContext();
    const tones = ok ? [[1250, 0.08]] : [[320, 0.12], [260, 0.16]];
    let t = ctx.currentTime;
    for (const [freq, dur] of tones) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = 'square';
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur);
      t += dur + 0.04;
    }
  } catch {
    /* звук недоступний — не страшно */
  }
}

/** Кожен скан обробляється рівно один раз — хоч би який екран його отримав */
let lastHandled = 0;
export function claimScan(n: number): boolean {
  if (n <= lastHandled) return false;
  lastHandled = n;
  return true;
}

/** Скан у відкрите вікно (надходження товару, картка товару) */
export const SCAN_EVENT = 'gryadka:scan';
