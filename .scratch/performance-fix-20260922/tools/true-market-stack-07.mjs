// 07 真行情服務編排：以日常開發入口（主工作區 vercel dev）當後端，before／after 兩個 Vite 分別服務
// git archive 出的產品副本；起跑後寫入即時身分（owned／listener PID、port、command、版本、工具雜湊）。
// 停止：在 evidence 目錄建立 STOP 檔或送 SIGINT；只 taskkill 本腳本自己 spawn 的程序樹。
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const valueOf = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null; };
const root = process.cwd();
const featureRoot = path.join(root, '.scratch', 'performance-fix-20260922');
const runId = valueOf('--run-id');
const holdingsRunId = valueOf('--holdings-run-id');
const pagePortBase = Number(valueOf('--page-port-base'));
if (!runId || !/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error('--run-id 無效');
if (!holdingsRunId || !/^[a-z0-9][a-z0-9._-]*$/i.test(holdingsRunId)) throw new Error('--holdings-run-id 無效');
if (!Number.isInteger(pagePortBase) || pagePortBase < 1024 || pagePortBase > 65524) throw new Error('--page-port-base 必須是可容納 12 個全新 port 的起點');
const evidenceDir = path.join(featureRoot, 'evidence', '07', runId);
if (fs.existsSync(evidenceDir)) throw new Error(`evidence 已存在，拒絕覆寫：${evidenceDir}`);
if (fs.existsSync(path.join(featureRoot, 'evidence', '05', holdingsRunId))) throw new Error('holdings evidence 已存在，拒絕覆寫');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const fileHash = file => sha256(fs.readFileSync(file));
const git = gitArgs => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim();
// 每頁一個從未開過的 port（新 origin 無瀏覽器 HTTP 快取）；before 用奇數、after 用偶數。
const pages = [
  ['h10-before-1', 'before', pagePortBase], ['h10-after-1', 'after', pagePortBase + 1],
  ['h10-before-2', 'before', pagePortBase + 2], ['h10-after-2', 'after', pagePortBase + 3],
  ['h10-before-3', 'before', pagePortBase + 4], ['h10-after-3', 'after', pagePortBase + 5],
  ['h30-before', 'before', pagePortBase + 6], ['h30-after', 'after', pagePortBase + 7],
  ['chart-before-1', 'before', pagePortBase + 8], ['chart-after-1', 'after', pagePortBase + 9],
  ['chart-before-2', 'before', pagePortBase + 10], ['chart-after-2', 'after', pagePortBase + 11],
];
const reservedPorts = new Set([3041, 4193, 4197]);
const pagePorts = pages.map(([, , port]) => port);
if (pagePorts.some(port => reservedPorts.has(port))) throw new Error('頁面 port 與本案後端／收集器衝突');
const evidence07 = path.join(featureRoot, 'evidence', '07');
for (const entry of fs.readdirSync(evidence07, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const identityPath = path.join(evidence07, entry.name, 'identity.json');
  if (!fs.existsSync(identityPath)) continue;
  const prior = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  const used = Object.values(prior.services ?? {}).map(service => service.port);
  if (pagePorts.some(port => used.includes(port))) throw new Error(`頁面 port 曾由 ${entry.name} 使用；請選全新 --page-port-base`);
}
fs.mkdirSync(path.join(evidenceDir, 'stack'), { recursive: true });
const ports = { backend: 3041, holdingsCapture: 4193, capture07: 4197, ...Object.fromEntries(pages.map(([name, , port]) => [name, port])) };
const runtimes = {
  before: { dir: path.join(featureRoot, 'runtime', '07-before-444d6b1'), commit: '444d6b1' },
  after: { dir: path.join(featureRoot, 'runtime', '07-after-6eee87e'), commit: '6eee87e' },
};
const toolDir = path.join(featureRoot, 'tools');
const viteConfig = path.join(toolDir, valueOf('--vite-config') ?? 'true-market-07-vite.config.mjs');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const vercelCli = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'vercel', 'dist', 'vc.js');
for (const file of [viteConfig, viteCli, vercelCli, ...Object.values(runtimes).map(r => r.dir)]) {
  if (!fs.existsSync(file)) throw new Error(`缺依賴：${file}`);
}

const env = { ...process.env, VERCEL_TELEMETRY_DISABLED: '1', NO_UPDATE_NOTIFIER: '1', PERF_TRUE_MARKET_BACKEND: `http://127.0.0.1:${ports.backend}` };
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] = `${path.join(root, 'node_modules', '.bin')}${path.delimiter}${env[pathKey] ?? ''}`;
const specs = {
  backend: { cwd: root, argv: [vercelCli, 'dev', '--listen', String(ports.backend)], ready: /Ready! Available at/i },
  holdingsCapture: { cwd: root, argv: [path.join(toolDir, 'holdings-true-market-capture.mjs'), '--port', String(ports.holdingsCapture), '--run-id', holdingsRunId], ready: /"pid"/ },
  capture07: { cwd: root, argv: [path.join(toolDir, 'capture-evidence-07.mjs'), '--port', String(ports.capture07), '--run-id', runId], ready: /"pid"/ },
  ...Object.fromEntries(pages.map(([name, variant, port]) => [name, {
    cwd: runtimes[variant].dir,
    variant,
    cacheDir: path.join(runtimes[variant].dir, '.perf07-cache', runId, String(port)),
    argv: [viteCli, '--config', viteConfig, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    ready: /ready in/i,
  }])),
};
const children = {};
const logs = {};
for (const [name, spec] of Object.entries(specs)) {
  const childEnv = spec.cacheDir ? { ...env, PERF_VITE_CACHE_DIR: spec.cacheDir } : env;
  const child = spawn(process.execPath, spec.argv, { cwd: spec.cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const out = fs.createWriteStream(path.join(evidenceDir, 'stack', `${name}.log`));
  logs[name] = '';
  const sink = chunk => { logs[name] += chunk.toString(); out.write(chunk); };
  child.stdout.on('data', sink);
  child.stderr.on('data', sink);
  children[name] = child;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const tcpReady = port => new Promise(resolve => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
  socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
});
const listenerPid = port => {
  const output = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
    if (match && Number(match[1]) === port) return Number(match[2]);
  }
  return null;
};
const stopAll = reason => {
  const stopped = {};
  for (const [name, child] of Object.entries(children)) {
    if (!child.pid) continue;
    const r = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
    stopped[name] = { pid: child.pid, exitCode: r.status };
  }
  fs.writeFileSync(path.join(evidenceDir, 'stopped.json'), JSON.stringify({ stoppedAt: new Date().toISOString(), reason, stopped }, null, 2) + '\n');
};

try {
  const deadline = Date.now() + 180_000;
  for (const [name, spec] of Object.entries(specs)) {
    while (!(spec.ready.test(logs[name]) && await tcpReady(ports[name]))) {
      if (children[name].exitCode !== null) throw new Error(`${name} 就緒前結束，exit=${children[name].exitCode}`);
      if (Date.now() > deadline) throw new Error(`${name} 就緒逾時`);
      await wait(200);
    }
  }
  const services = Object.fromEntries(Object.entries(specs).map(([name, spec]) => [name, {
    spawnPid: children[name].pid,
    listenerPid: listenerPid(ports[name]),
    port: ports[name],
    cwd: spec.cwd,
    variant: spec.variant ?? null,
    viteCacheDir: spec.cacheDir ?? null,
    command: [process.execPath, ...spec.argv],
  }]));
  const mismatched = Object.entries(services).filter(([, s]) => s.spawnPid !== s.listenerPid).map(([name]) => name);
  const runtimeManifest = dir => {
    const files = [];
    // 只涵蓋產品檔與探針；Vite 預打包目錄（node_modules/.vite、.perf07-cache）是執行產物，排除。
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['node_modules', '.perf07-cache'].includes(e.name)) walk(p); } else files.push({ path: path.relative(dir, p).replaceAll('\\', '/'), sha256: fileHash(p) }); } };
    walk(dir);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { fileCount: files.length, manifestSha256: sha256(files.map(f => `${f.path}\0${f.sha256}\n`).join('')) };
  };
  const envPath = path.join(root, '.env');
  const identity = {
    schemaVersion: 1,
    runId,
    holdingsRunId,
    createdAt: new Date().toISOString(),
    head: git(['rev-parse', 'HEAD']),
    backendEntry: '主工作區 vercel dev（日常開發入口：E2 設定的 .vercelignore／vite.config.ts）',
    backendConfig: { vercelignoreSha256: fileHash(path.join(root, '.vercelignore')), viteConfigSha256: fileHash(path.join(root, 'vite.config.ts')) },
    runtimes: Object.fromEntries(Object.entries(runtimes).map(([name, r]) => [name, { commit: git(['rev-parse', r.commit]), dir: r.dir, ...runtimeManifest(r.dir) }])),
    tools: Object.fromEntries(['true-market-stack-07.mjs', 'true-market-07-vite.config.mjs', 'holdings-true-market-vite.config.mjs', 'holdings-true-market-probe.jsx', 'holdings-true-market-30-probe.jsx', 'chart-true-market-probe.jsx', 'holdings-true-market-capture.mjs', 'capture-evidence-07.mjs', 'verify-holdings-true-market.mjs'].map(name => [name, fileHash(path.join(toolDir, name))])),
    runtime: {
      nodeVersion: process.version,
      vercelVersion: JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(vercelCli)), 'package.json'), 'utf8')).version,
      viteVersion: JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'vite', 'package.json'), 'utf8')).version,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    services,
    listenerMismatch: mismatched,
    envVariableNames: fs.existsSync(envPath)
      ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => l.slice(0, l.indexOf('=')).trim()).sort()
      : [],
    requestBudget: {
      holdings10: '每頁 16（10 報價＋1 匯率＋5 名稱）× 6 頁 = 96',
      holdings30: '每頁 46（30 報價＋1 匯率＋15 名稱）× 2 頁 = 92',
      chart10: '每頁冷抓 35（5 台股 × 2 chart＋3 FinMind、5 美股 × 2 chart）＋回訪 0 × 4 頁 = 140',
      stopRule: '任一頁出現 429、持續 5xx 或逾時即停止該批，保留結果，不密集重試',
    },
    viteConfig: path.relative(root, viteConfig).split(path.sep).join('/'),
    cacheMode: `每頁使用從未開過的 port ${pagePortBase}～${pagePortBase + 11}（新 origin 無瀏覽器 HTTP 快取）；每個 Vite 獨立預打包目錄；探針另清行情 session 快取；後端無本機持久快取`,
  };
  fs.writeFileSync(path.join(evidenceDir, 'identity.json'), JSON.stringify(identity, null, 2) + '\n');
  if (mismatched.length) throw new Error(`listener PID 非 owned spawn：${mismatched.join(', ')}`);
  console.log(JSON.stringify({ ready: true, services: Object.fromEntries(Object.entries(services).map(([n, s]) => [n, `${s.spawnPid}/${s.listenerPid}@${s.port}`])), listenerMismatch: mismatched }));
} catch (error) {
  console.error(String(error));
  stopAll(`啟動失敗：${error}`);
  process.exit(1);
}

const stopFile = path.join(evidenceDir, 'STOP');
const onSignal = () => { stopAll('signal'); process.exit(0); };
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);
while (!fs.existsSync(stopFile)) {
  for (const [name, child] of Object.entries(children)) {
    if (child.exitCode !== null) { stopAll(`${name} 意外結束 exit=${child.exitCode}`); process.exit(1); }
  }
  await wait(1000);
}
fs.unlinkSync(stopFile);
stopAll('STOP 檔');
