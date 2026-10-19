// Сервер «Грядки»: хранит журнал операций всех устройств и отдаёт веб-версию.
// Без внешних зависимостей: только Node.js 22+ (встроенный SQLite).
//
// Переменные окружения:
//   SHOP_KEY   — ключ магазина (обязателен), его вводят в приложениях
//   SHOP_NAME  — название магазина (необязательно)
//   PORT       — порт, по умолчанию 8787
//   DATA_DIR   — папка для базы и резервных копий, по умолчанию ./data
//   STATIC_DIR — собранная веб-версия, по умолчанию ../app/dist
//   DEMO_DATA  — 1: если база пустая, заполнить демо-данными (для показа заказчику)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const SHOP_KEY = process.env.SHOP_KEY || '';
const SHOP_NAME = process.env.SHOP_NAME || 'Магазин насіння';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(here, 'data'));
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(here, '..', 'app', 'dist'));
const KEEP_BACKUPS = 30;

if (SHOP_KEY.length < 8) {
  console.error('Задайте SHOP_KEY (минимум 8 символов), например: SHOP_KEY=$(openssl rand -hex 16)');
  process.exit(1);
}

fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'gryadka.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS events (
    seq      INTEGER PRIMARY KEY AUTOINCREMENT,
    id       TEXT NOT NULL UNIQUE,
    type     TEXT NOT NULL,
    ts       TEXT NOT NULL,
    device   TEXT NOT NULL,
    p        TEXT NOT NULL,
    received TEXT NOT NULL
  );
`);

const insert = db.prepare('INSERT OR IGNORE INTO events (id, type, ts, device, p, received) VALUES (?, ?, ?, ?, ?, ?)');
const since = db.prepare('SELECT seq, id, type, ts, device, p FROM events WHERE seq > ? ORDER BY seq LIMIT ?');
const countAll = db.prepare('SELECT COUNT(*) AS n, MAX(seq) AS last FROM events');

const TYPES = new Set(['product.upsert', 'purchase', 'sale', 'sale.return', 'expense', 'stock.adjust', 'void']);
const PAGE = 2000;

function validEvent(e) {
  return (
    e &&
    typeof e.id === 'string' &&
    e.id.length >= 8 &&
    e.id.length <= 64 &&
    TYPES.has(e.type) &&
    typeof e.ts === 'string' &&
    !Number.isNaN(Date.parse(e.ts)) &&
    typeof e.device === 'string' &&
    e.device.length <= 80 &&
    e.p &&
    typeof e.p === 'object'
  );
}

function authorized(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(SHOP_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(data);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  let file = path.join(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR)) return send(res, 403, 'forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC_DIR, 'index.html');
  if (!fs.existsSync(file)) return send(res, 404, 'Веб-версия не собрана: выполните npm run build в папке app');
  const ext = path.extname(file);
  const immutable = rel.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        return res.end();
      }
      if (url.pathname === '/api/health') return send(res, 200, { ok: true }, CORS);
      if (!authorized(req)) {
        await new Promise((r) => setTimeout(r, 400)); // замедляем подбор ключа
        return send(res, 401, { error: 'unauthorized' }, CORS);
      }
      if (url.pathname === '/api/hello' && req.method === 'GET') {
        const c = countAll.get();
        return send(res, 200, { ok: true, shop: SHOP_NAME, events: c.n }, CORS);
      }
      if (url.pathname === '/api/sync' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const incoming = Array.isArray(body.events) ? body.events : [];
        const now = new Date().toISOString();
        db.exec('BEGIN');
        try {
          for (const e of incoming) {
            if (!validEvent(e)) continue;
            insert.run(e.id, e.type, e.ts, e.device, JSON.stringify(e.p), now);
          }
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
        const cursor = Math.max(0, Number(body.cursor) || 0);
        const rows = since.all(cursor, PAGE + 1);
        const more = rows.length > PAGE;
        const page = more ? rows.slice(0, PAGE) : rows;
        const events = page.map((r) => ({ id: r.id, type: r.type, ts: r.ts, device: r.device, p: JSON.parse(r.p), seq: r.seq }));
        const next = page.length ? page[page.length - 1].seq : cursor;
        return send(res, 200, { events, cursor: next, more, shop: SHOP_NAME }, CORS);
      }
      if (url.pathname === '/api/export' && req.method === 'GET') {
        const rows = since.all(0, 10_000_000);
        const events = rows.map((r) => ({ id: r.id, type: r.type, ts: r.ts, device: r.device, p: JSON.parse(r.p) }));
        return send(res, 200, { app: 'gryadka', exportedAt: new Date().toISOString(), events }, {
          ...CORS,
          'Content-Disposition': `attachment; filename="gryadka-${new Date().toISOString().slice(0, 10)}.json"`,
        });
      }
      return send(res, 404, { error: 'not found' }, CORS);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: 'server error' }, CORS);
  }
});

/* Резервная копия базы раз в сутки (и при старте), хранится 30 последних */
function backup() {
  try {
    const name = `gryadka-${new Date().toISOString().slice(0, 10)}.db`;
    const target = path.join(DATA_DIR, 'backups', name);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const files = fs.readdirSync(path.join(DATA_DIR, 'backups')).filter((f) => f.endsWith('.db')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(DATA_DIR, 'backups', f));
  } catch (err) {
    console.error('backup failed', err);
  }
}
backup();
setInterval(backup, 24 * 60 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Грядка: сервер запущен на http://localhost:${PORT} (данные: ${DATA_DIR})`);
  if (process.env.DEMO_DATA === '1' && countAll.get().n === 0) {
    console.log('База пустая и DEMO_DATA=1 — заполняю демо-данными…');
    spawn(process.execPath, [path.join(here, 'demo-data.mjs'), `http://127.0.0.1:${PORT}`, SHOP_KEY], { stdio: 'inherit' });
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
