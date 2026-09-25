// 03 票：在原 http://localhost:3000 驗收時保護使用者的真帳本。
//
// 真帳本存在使用者自己 Chrome 的 localhost:3000 localStorage。若那邊還留著 App 分頁，Vite 客戶端
// 會在分頁可見時用 vite-ping WebSocket 輪詢，一接通就整頁重新整理；換成本輪固定資料服務時，
// 舊分頁會把假名錄、假 AI 快取甚至假快照寫進真帳本。這裡提供兩道保護：
// 1. 哨兵：起服務前先短暫占用該埠，完成 vite-ping 握手並回一張沒有腳本的告示頁，讓可見的舊分頁
//    改停在告示頁、不再輪詢。只記請求類型與時間，不記 header、cookie 或查詢字串。
// 2. 監看：服務期間定期列出連到該埠的用戶端連線；擁有者不在允許的程序樹內（本工具、本輪隔離
//    Chrome）即為外部用戶端，由呼叫端立刻停服務並判本輪無效。
// 查詢一律非同步執行，不卡住同一程序內的瀏覽器驅動。
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const NOTICE = [
  '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>本機 3000 埠暫用中</title></head>',
  '<body style="font-family:sans-serif;padding:2rem;line-height:1.6">',
  '<h1>localhost:3000 目前由 03 驗收測試暫用</h1>',
  '<p>測試使用獨立的瀏覽器資料目錄，不會讀寫這個分頁的資料；這張告示頁也沒有任何腳本。</p>',
  '<p>測試結束後照常啟動日常入口，再重新整理本頁即可。</p>',
  '</body></html>',
].join('');

const pathOnly = url => String(url || '/').split('?')[0];
const run = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

// 哨兵：兩個 loopback 位址都聽（localhost 在本機可能解析成 ::1 或 127.0.0.1）。
// 最後一次完成 vite-ping 之後至少再服務 holdMs，讓該分頁的重新整理拿得到告示頁而不是連線失敗頁。
export async function runSentinel({ port, durationMs = 8000, holdMs = 3000 }) {
  const started = Date.now();
  const events = [];
  let lastPingAt = null;
  const servers = [];
  const onRequest = (req, res) => {
    events.push({ atMs: Date.now() - started, kind: 'http', method: req.method, path: pathOnly(req.url),
      family: req.socket.remoteFamily ?? null });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(NOTICE);
  };
  const onUpgrade = (req, socket) => {
    const protocols = String(req.headers['sec-websocket-protocol'] || '').split(',').map(value => value.trim());
    const key = req.headers['sec-websocket-key'];
    const ping = protocols.includes('vite-ping') && typeof key === 'string';
    events.push({ atMs: Date.now() - started, kind: ping ? 'vite-ping' : 'upgrade-other', path: pathOnly(req.url),
      family: req.socket.remoteFamily ?? null });
    if (!ping) { socket.destroy(); return; }
    lastPingAt = Date.now();
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.end(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`, 'Sec-WebSocket-Protocol: vite-ping', '', ''].join('\r\n'));
  };
  const bound = [];
  const bindErrors = [];
  try {
    for (const host of ['127.0.0.1', '::1']) {
      const server = http.createServer(onRequest);
      server.on('upgrade', onUpgrade);
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, host, resolve);
        });
        servers.push(server);
        bound.push(host);
      } catch (error) {
        bindErrors.push({ host, code: error.code ?? error.message });
      }
    }
    if (!bound.length) throw new Error(`哨兵無法占用 ${port}：${JSON.stringify(bindErrors)}`);
    while (Date.now() - started < durationMs || (lastPingAt && Date.now() - lastPingAt < holdMs)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally {
    await Promise.all(servers.map(server => new Promise(resolve => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    })));
  }
  return {
    port, durationMs, holdMs, ranMs: Date.now() - started, bound, bindErrors, events,
    visibleTabsNeutralized: events.filter(event => event.kind === 'vite-ping').length,
  };
}

// netstat -ano 的 TCP 連線列（IPv4 與 IPv6 同一格式）。
export async function tcpRows() {
  const [v4, v6] = await Promise.all([run('netstat', ['-ano', '-p', 'TCP']), run('netstat', ['-ano', '-p', 'TCPv6'])]);
  const rows = [];
  for (const line of `${v4}\n${v6}`.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+(\S+):(\d+)\s+(\S+):(\d+)\s+(\S+)\s+(\d+)\s*$/);
    if (!match) continue;
    rows.push({ local: match[1], localPort: Number(match[2]), remote: match[3], remotePort: Number(match[4]),
      state: match[5], pid: Number(match[6]) });
  }
  return rows;
}

export async function listenerRows(port) {
  return (await tcpRows()).filter(row => row.state === 'LISTENING' && row.localPort === port)
    .map(({ local, localPort, pid }) => ({ local, localPort, pid }));
}

// 所有程序的父子關係與建立時間（一次 CIM 查詢）；用來判斷 PID 是否屬於允許的程序樹。
export async function processTable() {
  const command = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json -Compress';
  const stdout = await run('powershell', ['-NoProfile', '-Command', command]);
  const list = JSON.parse(stdout);
  return new Map((Array.isArray(list) ? list : [list]).map(row => [row.ProcessId, row]));
}

// node 程序表（含建立時間與命令列）；命令列只在記憶體內判斷身分，呼叫端不得寫進證據。
export async function nodeProcesses() {
  const command = 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress';
  const stdout = (await run('powershell', ['-NoProfile', '-Command', command])).trim();
  if (!stdout) return new Map();
  const list = JSON.parse(stdout);
  return new Map((Array.isArray(list) ? list : [list]).map(row => [row.ProcessId, row]));
}

// 命令列中的第一個腳本檔名（daily-dev.mjs／vc.js／vite.js／dev-server.mjs），證據只記這個名稱。
export const scriptOf = commandLine => (commandLine ?? '').match(/[^\\/"\s]+\.(?:mjs|js|cjs)\b/)?.[0] ?? null;

// 證據共用的去識別身分欄位；不輸出完整命令列。
export function identityFields(table, pids) {
  return pids.map(pid => {
    const row = table.get(pid);
    return row ? { pid, parentPid: row.ParentProcessId, creationDate: row.CreationDate, script: scriptOf(row.CommandLine) }
      : { pid, missing: true };
  });
}

// 某程序底下的整棵子孫樹（驗收端的獨立實作，不沿用啟動器的程式）。Windows 父 PID 在父程序結束後不會清掉，
// PID 又會被重用，所以子程序的建立時間必須不早於父程序才算成員；只記 PID、父 PID、程序名與建立時間。
const creationMs = value => {
  const text = String(value ?? '');
  const legacy = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(text);
  return legacy ? Number(legacy[1]) : Date.parse(text);
};
export function descendantTree(table, rootPid) {
  const out = [];
  const seen = new Set([rootPid]);
  const walk = (parent, parentMs) => {
    for (const row of table.values()) {
      if (row.ParentProcessId !== parent || seen.has(row.ProcessId)) continue;
      const ms = creationMs(row.CreationDate);
      if (!(ms >= parentMs)) continue;
      seen.add(row.ProcessId);
      out.push({ pid: row.ProcessId, parentPid: parent, name: row.Name, creationDate: row.CreationDate });
      walk(row.ProcessId, ms);
    }
  };
  walk(rootPid, creationMs(table.get(rootPid)?.CreationDate));
  return out;
}

// 日常入口的程序樹：略過各層短命的查詢程序（powershell 及其子孫），其餘全部列入（含看門程序）。
export function launcherTree(table, rootPid) {
  const all = descendantTree(table, rootPid);
  const dropped = new Set(all.filter(item => item.name === 'powershell.exe').map(item => item.pid));
  for (const item of all) if (dropped.has(item.parentPid)) dropped.add(item.pid);   // 走訪順序為先父後子
  return all.filter(item => !dropped.has(item.pid));
}

// 驗收端獨立於 daily-dev 的清理實作：每次重新核對身分並擴展當下子孫，只結束指定的單一 PID。
export async function terminateVerifiedTree(records, { readTable = processTable, terminate = async item => {
  try {
    await run('taskkill', ['/PID', String(item.pid), '/F']);
    return { status: 0 };
  } catch (error) {
    return { status: error.code ?? 1 };
  }
} } = {}) {
  const known = new Map(records.map(item => [`${item.pid}|${item.creationDate}`, item]));
  const attempted = new Set();
  const killed = [];
  const alive = table => [...known.values()].filter(item => Number.isFinite(creationMs(item.creationDate))
    && table.get(item.pid)?.CreationDate === item.creationDate);
  while (true) {
    const table = await readTable();
    for (const root of alive(table)) {
      for (const item of launcherTree(table, root.pid)) known.set(`${item.pid}|${item.creationDate}`, item);
    }
    const item = alive(table).find(row => !attempted.has(`${row.pid}|${row.creationDate}`));
    if (!item) return { killed, stillAlive: alive(table).map(row => row.pid) };
    attempted.add(`${item.pid}|${item.creationDate}`);
    const result = await terminate(item);
    killed.push({ pid: item.pid, name: item.name ?? null, creationDate: item.creationDate, status: result.status });
  }
}

export function descends(table, pid, roots) {
  const seen = new Set();
  let current = pid;
  while (current && !seen.has(current)) {
    if (roots.has(current)) return true;
    seen.add(current);
    current = table.get(current)?.ParentProcessId;
  }
  return false;
}

// 監看：每 intervalMs 查一次連到 port 的用戶端連線。allowedRoots() 回傳目前允許的根 PID；
// 不明 PID 會先重讀程序表確認不是允許樹的子程序，才記為外部並呼叫 onForeign。
export function startForeignMonitor({ port, allowedRoots, onForeign, intervalMs = 300 }) {
  const foreign = [];
  const allowedSeen = new Set();
  const reported = new Set();
  let stopped = false;
  let busy = false;
  let checks = 0;
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      checks += 1;
      const clients = (await tcpRows()).filter(row => row.remotePort === port && row.localPort !== port
        && ['ESTABLISHED', 'SYN_SENT'].includes(row.state));
      const unknown = [...new Set(clients.map(row => row.pid))]
        .filter(pid => !allowedSeen.has(pid) && !reported.has(pid));
      if (!unknown.length) return;
      const roots = new Set(allowedRoots());
      const table = await processTable();
      for (const pid of unknown) {
        if (descends(table, pid, roots)) {
          allowedSeen.add(pid);
          continue;
        }
        const record = { at: new Date().toISOString(), pid, name: table.get(pid)?.Name ?? null };
        reported.add(pid);
        foreign.push(record);
        onForeign?.(record);
      }
    } catch (error) {
      foreign.push({ at: new Date().toISOString(), monitorError: error.message });
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  return {
    get foreign() { return foreign; },
    stop() {
      stopped = true;
      clearInterval(timer);
      return { port, intervalMs, checks, foreign, allowedClientPids: [...allowedSeen] };
    },
  };
}
