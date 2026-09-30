// 03 平台取消的診斷迴圈（非正式證據，不寫進 evidence/）：
// 對 Preview 送 N 筆「收到首段 delta 就斷線」的串流請求（與 r3 第 11 筆同形），
// 再用已登入的 vercel CLI 撈同請求的平台 logs 判定：
//   紅＝伺服器照樣跑到 done／response-finish、假 CLI 沒被 kill（使用者回報的症狀）
//   綠＝假 CLI 被 kill 且沒有 done（取消已傳到 handler 並停掉上游）
// 平台觸發的事件（req error/close、res close）跑在請求的 async context 之外，fixture 記不到 trace，
// 這裡改依「同一筆平台請求紀錄」歸屬；因此請求之間要留間隔，避免 Fluid 同實例並行把事件混在一起。
// 用法：node cancel-loop.mjs <preview-origin> [筆數=1] [deploymentId] [路由=/api/gemini-stream] [間隔ms=15000]
// 結束碼：1＝有紅（重現 bug）、0＝全綠、2＝判不出來（logs 缺）
import https from 'node:https';
import { spawnSync } from 'node:child_process';

// 第 6 個參數 cancelAfterMs：有給就改成「送出後固定毫秒數斷線」（模擬伺服器還沒寫任何東西時就離開，如長時間思考）
const [originArg, countArg = '1', deploymentArg, routeArg = '/api/gemini-stream', gapArg = '15000', cancelAfterArg] = process.argv.slice(2);
const cancelAfterMs = cancelAfterArg === undefined ? null : Number(cancelAfterArg);
const origin = new URL(originArg);
if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.vercel.app') || origin.pathname !== '/') {
  throw new Error('需要具名 Vercel Preview HTTPS origin（結尾 /）');
}
const count = Number(countArg);
const gapMs = Number(gapArg);
const deployment = deploymentArg ?? origin.hostname;
const tag = `diag03-${Date.now().toString(36)}`;
const PROJECT = 'E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4';
const body = JSON.stringify({ prompt: '固定測試', systemInstruction: '固定測試', mode: 'fast' });

// ── 1. 送請求：與 platform-03.mjs 第 11 筆相同（首個 delta 進來就 req.destroy()）──────────
const sendOne = i => new Promise(resolve => {
  const trace = `${tag}-${i}`;
  const t0 = Date.now();
  let text = '';
  let settled = false;
  const finish = extra => { if (!settled) { settled = true; resolve({ trace, startedAt: new Date(t0).toISOString(), ...extra }); } };
  const req = https.request(new URL(routeArg, origin), {
    method: 'POST',
    headers: { 'x-perf03-trace': trace, 'content-type': 'application/json', origin: origin.origin },
    timeout: 30000,
  }, res => {
    res.setEncoding('utf8');
    res.on('data', chunk => {
      text += chunk;
      if (text.includes('"t":"delta"')) {
        req.destroy();
        finish({ status: res.statusCode, canceledAtMs: Date.now() - t0, received: text.trim() });
      }
    });
    res.on('end', () => finish({ status: res.statusCode, completedWithoutCancel: true, received: text.trim() }));
    res.on('error', error => finish({ error: error.message }));
  });
  req.on('timeout', () => req.destroy(new Error('request timeout')));
  req.on('error', error => { if (!settled) finish({ error: error.message }); });
  if (cancelAfterMs !== null) {
    setTimeout(() => {
      if (settled) return;
      req.destroy();
      finish({ canceledAtMs: Date.now() - t0, canceledBeforeAnyByte: text === '', received: text.trim() });
    }, cancelAfterMs);
  }
  req.end(body);
});

const client = [];
for (let i = 0; i < count; i++) {
  if (i > 0) await new Promise(r => setTimeout(r, gapMs));
  client.push(await sendOne(i));
}

// ── 2. 撈平台 logs（保留期很短，要當場撈；最多等 90 秒直到每個 trace 都有終局事件）──────
const TERMINAL = new Set(['child.fakeCli.done', 'child.fakeCli.kill']);
const otherLogs = new Map(); // 同路由但不是注入事件的平台紀錄（當機、逾時、平台訊息）
const parseEvents = lines => {
  const events = new Map();
  for (const line of lines) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const messages = [record.message, ...(Array.isArray(record.logs) ? record.logs.map(l => l.message) : [])];
    const parsed = [];
    for (const message of messages) {
      if (typeof message !== 'string' || !message) continue;
      if (!message.includes('perf03-platform')) {
        if (record.requestPath === routeArg) {
          otherLogs.set(`${record.level}|${message}`, { level: record.level, status: record.responseStatusCode, message: message.slice(0, 240) });
        }
        continue;
      }
      try { parsed.push(JSON.parse(message)); } catch { /* 非 JSON 行略過 */ }
    }
    // 同一筆平台請求紀錄裡只有一個具名 trace 時，把沒有 trace 的平台觸發事件歸給它
    const named = [...new Set(parsed.map(e => e.trace).filter(Boolean))];
    const recordTrace = named.length === 1 ? named[0] : null;
    for (const event of parsed) {
      const trace = event.trace || recordTrace;
      if (!trace?.startsWith(tag)) continue;
      events.set(`${trace}|${event.event}|${event.atMs}|${event.index ?? ''}`, { ...event, trace, attributed: !event.trace });
    }
  }
  const byTrace = new Map();
  for (const event of events.values()) {
    if (!byTrace.has(event.trace)) byTrace.set(event.trace, []);
    byTrace.get(event.trace).push(event);
  }
  for (const list of byTrace.values()) list.sort((a, b) => a.atMs - b.atMs);
  return byTrace;
};
let byTrace = new Map();
let rawLines = 0;
for (let waited = 0; waited <= 90; waited += 10) {
  await new Promise(r => setTimeout(r, 10000));
  const r = spawnSync('vercel', ['logs', '--deployment', deployment, '--since', '20m', '--json', '--expand', '--limit', '100', '--cwd', `"${PROJECT}"`],
    { shell: true, encoding: 'utf8', maxBuffer: 1 << 26 });
  const lines = (r.stdout ?? '').split(/\r?\n/).filter(l => l.startsWith('{'));
  rawLines = lines.length;
  byTrace = parseEvents(lines);
  const allTerminal = client.every(c => (byTrace.get(c.trace) ?? []).some(e => TERMINAL.has(e.event)));
  if (allTerminal) break;
}

// ── 3. 判定 ───────────────────────────────────────────────────────────────────────
const isSignal = e => e.event === 'request-aborted' || (e.event === 'response-close' && e.finished === false)
  || (e.event.endsWith('request-error') && e.message === 'aborted');
let red = 0, green = 0, unknown = 0;
const verdicts = client.map(c => {
  const events = byTrace.get(c.trace) ?? [];
  const find = name => events.find(e => e.event === name);
  const start = events[0]?.atMs ?? 0;
  const at = e => (e ? Math.round(e.atMs - start) : null);
  const kill = find('child.fakeCli.kill');
  const done = find('child.fakeCli.done');
  const firstSignal = events.find(isSignal);
  const verdict = events.length === 0 ? '判不出來（沒撈到 logs）'
    : done && !kill ? '紅：斷線後伺服器仍跑完'
    : kill && !done ? '綠：取消已傳到 handler 並停掉上游'
    : '判不出來（事件組合不完整）';
  if (verdict.startsWith('紅')) red++; else if (verdict.startsWith('綠')) green++; else unknown++;
  return {
    trace: c.trace, clientStatus: c.status, clientCanceledAtMs: c.canceledAtMs, clientError: c.error, verdict,
    firstSignalMs: at(firstSignal), firstSignal: firstSignal?.event, killMs: at(kill), deltasBeforeStop: kill?.emitted ?? null,
    serverTimeline: events.map(e => `${Math.round(e.atMs - start)}ms${e.attributed ? '*' : ''} ${e.event}${e.index ? '#' + e.index : ''}`
      + `${e.event === 'response-close' ? ` finished=${e.finished}` : ''}${e.emitted !== undefined ? ` emitted=${e.emitted}` : ''}`
      + `${e.message !== undefined ? ` message=${e.message}` : ''}${e.code ? ` code=${e.code}` : ''}`),
  };
});
console.log(JSON.stringify({ tag, origin: origin.origin, route: routeArg, deployment, gapMs, logLinesFetched: rawLines, red, green, unknown,
  note: '時間軸中 * ＝平台觸發、依請求紀錄歸屬的事件', verdicts, otherLogs: [...otherLogs.values()].slice(0, 20) }, null, 2));
process.exitCode = red > 0 ? 1 : unknown > 0 ? 2 : 0;
