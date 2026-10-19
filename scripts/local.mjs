// Локальний запуск однією командою: сервер + фронт, за бажанням — демо-дані.
//   npm start          — порожній магазин
//   npm run demo       — з демонстраційними даними (лише при першому запуску)
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.SHOP_KEY || 'dev-key-123';
const withDemo = process.argv.includes('--demo');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Потрібен Node.js 22.13 або новіший (зараз ${process.versions.node}).`);
  process.exit(1);
}

if (!fs.existsSync(path.join(root, 'app', 'node_modules'))) {
  console.log('Встановлюю залежності (один раз)…');
  execSync('npm install', { cwd: path.join(root, 'app'), stdio: 'inherit' });
}

const dataDir = path.join(root, 'server', 'data');
const fresh = !fs.existsSync(path.join(dataDir, 'gryadka.db'));
const procs = [];
const run = (name, cmd, args, cwd, env = {}) => {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = (s) => s.toString().split('\n').filter(Boolean).map((l) => `[${name}] ${l}`).join('\n');
  p.stdout.on('data', (d) => console.log(tag(d)));
  p.stderr.on('data', (d) => console.error(tag(d)));
  p.on('exit', (code) => {
    if (code) console.error(`[${name}] завершився з кодом ${code}`);
    shutdown();
  });
  procs.push(p);
  return p;
};
function shutdown() {
  for (const p of procs) if (!p.killed) p.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('сервер', process.execPath, ['--no-warnings=ExperimentalWarning', 'server.mjs'], path.join(root, 'server'), { SHOP_KEY: KEY, SHOP_NAME: process.env.SHOP_NAME || 'Магазин насіння' });
run('фронт', 'npm', ['run', 'dev', '--', '--host', '127.0.0.1'], path.join(root, 'app'));

// дочекатися сервера
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch('http://127.0.0.1:8787/api/health')).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
if (withDemo && fresh) {
  execSync(`"${process.execPath}" demo-data.mjs http://127.0.0.1:8787 ${KEY}`, { cwd: path.join(root, 'server'), stdio: 'inherit' });
} else if (withDemo) {
  console.log('Демо-дані вже є в базі — не додаю вдруге (щоб почати з нуля, видаліть server/data).');
}

const url = `http://localhost:1420/#key=${KEY}`;
console.log(`\n  Грядка запущена:  ${url}\n  Ключ магазину: ${KEY}\n  Зупинити: Ctrl+C\n`);
try {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  setTimeout(() => { try { execSync(`${opener} "${url}"`); } catch {} }, 1500);
} catch {}
