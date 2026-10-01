#!/usr/bin/env node
// 03 票：只在隔離 checkout 變更元件與 CSS，確認 Vite 分別送出 HMR 更新並逐位元組還原。
// 用法：node .scratch/performance-optimization-20260923/tools/hmr-03.mjs <新 run-id> <隔離 checkout> <未占用埠>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimRun, fileSha, startService, stopService } from './service-kit.mjs';

const [runId, workdirText, portText] = process.argv.slice(2);
const workdir = path.resolve(workdirText || '');
const port = Number(portText);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
if (!runId || !workdirText || workdir.toLowerCase() === root.toLowerCase()
  || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('需要 <新 run-id> <隔離 checkout> <未占用埠>');
}
const paths = ['App.tsx', 'index.css'];
const originals = Object.fromEntries(paths.map(file => [file, fs.readFileSync(path.join(workdir, file))]));
const { evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId });
const logFile = path.join(runtimeDir, 'vite.log');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(GEMINI_|FINMIND_|PROXY_SHARED_SECRET$|UPSTASH_|CLAUDE_|LLM_PROVIDER$|NODE_OPTIONS$|PERF01_)/i.test(key)) delete env[key];
}
const raw = {
  runId, workdir: workdir.replaceAll('\\', '/'), port, createdAt: new Date().toISOString(),
  source: {
    runnerSha256: fileSha(fileURLToPath(import.meta.url)),
    viteConfigSha256: fileSha(path.join(workdir, 'vite.config.ts')),
    originals: Object.fromEntries(paths.map(file => [file, fileSha(path.join(workdir, file))])),
  },
  updates: [], errors: [], service: null, restored: false,
};
let service;
let socket;
try {
  service = await startService({
    name: 'vite-hmr-03', argv: [path.join(workdir, 'node_modules/vite/bin/vite.js'),
      '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    env, port, readyPattern: /ready in/i, logFile, cwd: workdir,
  });
  if (!service.ready || service.listenerPid !== service.ownedPid) throw new Error('隔離 Vite 未由本工具獨占啟動');
  const origin = `http://127.0.0.1:${port}`;
  for (const file of paths) {
    const response = await fetch(`${origin}/${file}`);
    if (response.status !== 200) throw new Error(`${file} 未載入至 Vite 模組圖：${response.status}`);
    await response.arrayBuffer();
  }
  socket = new WebSocket(`ws://127.0.0.1:${port}/`, 'vite-hmr');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite HMR WebSocket 未連線')), 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Vite HMR WebSocket 錯誤')); }, { once: true });
  });
  const awaitUpdate = file => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error(`${file} 未收到 HMR update`));
    }, 10_000);
    const onMessage = event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.type !== 'update') return;
      const updates = (message.updates || []).map(update => ({ type: update.type, path: update.path }));
      raw.updates.push({ file, updates });
      if (updates.some(update => update.path === `/${file}`)) {
        clearTimeout(timer);
        socket.removeEventListener('message', onMessage);
        resolve();
      }
    };
    socket.addEventListener('message', onMessage);
  });
  for (const file of paths) {
    const pending = awaitUpdate(file);
    fs.appendFileSync(path.join(workdir, file), file.endsWith('.css')
      ? '\n/* 03 隔離 HMR 驗證 */\n' : '\n// 03 隔離 HMR 驗證\n');
    await pending;
    fs.writeFileSync(path.join(workdir, file), originals[file]);
  }
} catch (error) {
  raw.errors.push(error instanceof Error ? error.message : String(error));
} finally {
  socket?.close();
  for (const [file, bytes] of Object.entries(originals)) {
    const full = path.join(workdir, file);
    if (!fs.readFileSync(full).equals(bytes)) fs.writeFileSync(full, bytes);
  }
  raw.restored = Object.entries(originals).every(([file, bytes]) =>
    fs.readFileSync(path.join(workdir, file)).equals(bytes));
  if (service) {
    await stopService(service);
    raw.service = { ownedPid: service.ownedPid, listenerPid: service.listenerPid, stopped: service.stopped };
  }
  raw.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
}
const pass = raw.errors.length === 0 && raw.updates.length === 2
  && raw.restored && raw.service?.stopped === true;
console.log(JSON.stringify({ runId, pass, updates: raw.updates, restored: raw.restored,
  service: raw.service, errors: raw.errors }, null, 2));
process.exitCode = pass ? 0 : 1;
