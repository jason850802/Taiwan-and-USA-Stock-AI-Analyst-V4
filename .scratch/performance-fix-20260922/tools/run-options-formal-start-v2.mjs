import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const valueOf = name => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
};
const required = name => {
  const value = valueOf(name);
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
};
const root = process.cwd();
const featureRoot = path.join(root, '.scratch', 'performance-fix-20260922');
const runId = valueOf('--run-id') ?? 'formal-options-v2';
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error('--run-id 無效');
const runtimeBase = path.join(featureRoot, 'runtime', runId);
const setupPath = path.join(featureRoot, 'evidence', '01', runId, 'setup.json');
const variant = required('--variant');
if (!['e0', 'e1', 'e2', 'clean'].includes(variant)) throw new Error('--variant 無效');
const serviceStartId = required('--service-start-id');
const vercelPort = Number(required('--vercel-port'));
const vitePort = Number(required('--vite-port'));
const outputDir = path.resolve(required('--output-dir'));
if (![vercelPort, vitePort].every(port => Number.isInteger(port) && port > 0 && port < 65536)) throw new Error('port 無效');
if (fs.existsSync(outputDir)) throw new Error(`start evidence 已存在，拒絕覆寫：${outputDir}`);
if (!fs.existsSync(setupPath)) throw new Error('缺 formal v2 setup.json，請先執行 prepare-options-formal-v2.mjs');
const setup = JSON.parse(fs.readFileSync(setupPath, 'utf8'));
const runtimeRoot = setup.variants?.[variant]?.runtimeRoot;
if (!fs.existsSync(runtimeRoot)) throw new Error(`runtime 不存在：${runtimeRoot}`);
fs.mkdirSync(outputDir, { recursive: true });

const sha256 = value => createHash('sha256').update(value).digest('hex');
const fileHash = file => sha256(fs.readFileSync(file));
const tools = [
  'prepare-options-formal-v2.mjs',
  'run-options-formal-start-v2.mjs',
  'capture-options-formal.mjs',
  'merge-options-formal.mjs',
  'compare-options.mjs',
  'validate-options-formal-v2.mjs',
  'self-test.mjs',
];
const toolHashes = Object.fromEntries(tools.map(name => {
  const file = path.join(featureRoot, 'tools', name);
  if (!fs.existsSync(file)) throw new Error(`缺工具：${file}`);
  return [name, fileHash(file)];
}));
const vercelCli = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'vercel', 'dist', 'vc.js');
const vercelPackage = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'vercel', 'package.json');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const vitePackage = path.join(root, 'node_modules', 'vite', 'package.json');
for (const file of [vercelCli, vercelPackage, viteCli, vitePackage]) {
  if (!fs.existsSync(file)) throw new Error(`執行依賴不存在：${file}`);
}

const activeLock = path.join(runtimeBase, 'active.lock');
let lockFd;
try {
  lockFd = fs.openSync(activeLock, 'wx');
} catch {
  throw new Error(`formal runtime 已有 active.lock，拒絕平行切換設定：${activeLock}`);
}
try {
  if (variant !== 'clean') {
    const configDir = path.join(runtimeBase, 'configs', variant);
    fs.copyFileSync(path.join(configDir, '.vercelignore'), path.join(runtimeRoot, '.vercelignore'));
    fs.copyFileSync(path.join(configDir, 'vite.config.ts'), path.join(runtimeRoot, 'vite.config.ts'));
  }
  if (fileHash(path.join(runtimeRoot, '.vercelignore')) !== setup.variants[variant].vercelignoreSha256
    || fileHash(path.join(runtimeRoot, 'vite.config.ts')) !== setup.variants[variant].viteConfigSha256) {
    throw new Error(`${variant} runtime config hash 與 setup 不一致`);
  }
} catch (error) {
  fs.closeSync(lockFd);
  fs.unlinkSync(activeLock);
  throw error;
}

const logStreams = [];
const processLogs = new Map();
const logChild = (child, prefix) => {
  const stdout = fs.createWriteStream(path.join(outputDir, `${prefix}.stdout.log`));
  const stderr = fs.createWriteStream(path.join(outputDir, `${prefix}.stderr.log`));
  logStreams.push(stdout, stderr);
  const memory = { stdout: '', stderr: '' };
  processLogs.set(prefix, memory);
  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    memory.stdout += text;
    stdout.write(chunk);
  });
  child.stderr.on('data', chunk => {
    const text = chunk.toString();
    memory.stderr += text;
    stderr.write(chunk);
  });
};
const commonEnv = { ...process.env, VERCEL_TELEMETRY_DISABLED: '1', NO_UPDATE_NOTIFIER: '1' };
const pathKey = Object.keys(commonEnv).find(key => key.toLowerCase() === 'path') ?? 'PATH';
commonEnv[pathKey] = `${path.join(root, 'node_modules', '.bin')}${path.delimiter}${commonEnv[pathKey] ?? ''}`;
const viteArgs = [viteCli, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'];
const vercelArgs = [vercelCli, 'dev', '--listen', String(vercelPort)];
const vite = spawn(process.execPath, viteArgs, { cwd: runtimeRoot, env: commonEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const vercel = spawn(process.execPath, vercelArgs, { cwd: runtimeRoot, env: commonEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
logChild(vite, 'vite');
logChild(vercel, 'vercel');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const tcpReady = port => new Promise(resolve => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
  socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
});
const waitForPort = async (child, port, label, timeoutMs = 90_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} 在 port ready 前結束，exit=${child.exitCode}`);
    if (await tcpReady(port)) return;
    await wait(150);
  }
  throw new Error(`${label} ${port} 等待逾時`);
};
const waitForReadyLog = async (child, prefix, pattern, label, timeoutMs = 90_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} 在 ready log 前結束，exit=${child.exitCode}`);
    const memory = processLogs.get(prefix);
    const combined = `${memory?.stdout ?? ''}\n${memory?.stderr ?? ''}`;
    if (pattern.test(combined)) return;
    await wait(150);
  }
  throw new Error(`${label} ready log 等待逾時`);
};
const listenerPid = port => {
  const output = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('LISTENING')) continue;
    const match = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
    if (match && Number(match[1]) === port) return Number(match[2]);
  }
  return null;
};
const stopOwned = child => {
  if (!child?.pid) return { pid: null, exitCode: null };
  const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
  return { pid: child.pid, exitCode: result.status, stdout: result.stdout?.trim() || '', stderr: result.stderr?.trim() || '' };
};

const identityPath = path.join(outputDir, 'identity.json');
const statusPath = path.join(outputDir, 'status.json');
const rawPath = path.join(outputDir, 'raw.json');
const startedAt = new Date().toISOString();
let identity;
let failure = null;
let probe = null;
try {
  await Promise.all([
    Promise.all([
      waitForPort(vite, vitePort, 'vite'),
      waitForReadyLog(vite, 'vite', /ready in/i, 'vite'),
    ]),
    Promise.all([
      waitForPort(vercel, vercelPort, 'vercel'),
      waitForReadyLog(vercel, 'vercel', /Ready! Available at/i, 'vercel'),
    ]),
  ]);
  const viteListenerPid = listenerPid(vitePort);
  const vercelListenerPid = listenerPid(vercelPort);
  identity = {
    schemaVersion: 2,
    runId,
    createdAt: new Date().toISOString(),
    startedAt,
    variant,
    serviceStartId,
    source: {
      head: setup.head,
      baseManifestSha256: setup.baseManifestSha256,
      setupFileSha256: fileHash(setupPath),
      runtimeRoot,
    },
    config: {
      vercelignoreSha256: fileHash(path.join(runtimeRoot, '.vercelignore')),
      viteConfigSha256: fileHash(path.join(runtimeRoot, 'vite.config.ts')),
      expected: setup.variants[variant],
    },
    tools: toolHashes,
    runtime: {
      nodeVersion: process.version,
      nodeExecutable: process.execPath,
      ancestorNodeModulesBin: path.join(root, 'node_modules', '.bin'),
      vercelVersion: JSON.parse(fs.readFileSync(vercelPackage, 'utf8')).version,
      viteVersion: JSON.parse(fs.readFileSync(vitePackage, 'utf8')).version,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    services: {
      vite: {
        spawnPid: vite.pid,
        listenerPid: viteListenerPid,
        port: vitePort,
        cwd: runtimeRoot,
        command: [process.execPath, ...viteArgs],
      },
      vercel: {
        spawnPid: vercel.pid,
        listenerPid: vercelListenerPid,
        port: vercelPort,
        cwd: runtimeRoot,
        command: [process.execPath, ...vercelArgs],
      },
    },
    cacheMode: 'fresh independent process start; OPTIONS cold first, then paired warm rounds',
    envVariableNames: setup.envVariableNames,
  };
  fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2) + '\n');
  if (viteListenerPid !== vite.pid) throw new Error(`Vite listener PID ${viteListenerPid} 與 owned spawn PID ${vite.pid} 不一致`);
  if (vercelListenerPid !== vercel.pid) throw new Error(`Vercel listener PID ${vercelListenerPid} 與 owned spawn PID ${vercel.pid} 不一致`);

  const captureTool = path.join(featureRoot, 'tools', 'capture-options-formal.mjs');
  const captureArgs = [captureTool, '--base-url', `http://127.0.0.1:${vercelPort}/`, '--service-start-id', serviceStartId, '--output', rawPath, '--timeout-ms', '60000', '--warm-pairs', '5'];
  probe = spawnSync(process.execPath, captureArgs, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  fs.writeFileSync(path.join(outputDir, 'probe.stdout.log'), probe.stdout || '');
  fs.writeFileSync(path.join(outputDir, 'probe.stderr.log'), probe.stderr || '');
  if (probe.status !== 0) throw new Error(`formal OPTIONS probe 失敗，exit=${probe.status}`);
} catch (error) {
  failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
} finally {
  const stopped = { vercel: stopOwned(vercel), vite: stopOwned(vite) };
  for (const stream of logStreams) stream.end();
  const status = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    startedAt,
    variant,
    serviceStartId,
    success: failure === null,
    failure,
    probeExitCode: probe?.status ?? null,
    rawExists: fs.existsSync(rawPath),
    identityExists: fs.existsSync(identityPath),
    stopped,
  };
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n');
  if (lockFd !== undefined) fs.closeSync(lockFd);
  if (fs.existsSync(activeLock)) fs.unlinkSync(activeLock);
}

if (failure) {
  console.error(failure);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ variant, serviceStartId, vercelPort, vitePort, identityPath, rawPath, statusPath }, null, 2));
}
