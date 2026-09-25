#!/usr/bin/env node
// 03 票：在原 http://localhost:3000 用日常入口候選跑正式 App（固定上游＋假 AI），瀏覽器用全新的隔離資料目錄。
//
// 用法（repo 根目錄）：
//   node .scratch/performance-optimization-20260923/tools/app-03.mjs <新 run-id> [--viewports desktop,narrow]
//   開發期冒煙（不算正式、證據只留 runtime）：再加 --smoke --front-port <埠> --api-port <埠>
//
// 流程：port-guard 哨兵接走可見的舊分頁 → 以固定資料模式啟動 daily-dev.mjs（預設 3000／3001）→
// 每種視窗各開一個全新 user-data-dir 的 headless Chrome，用 CDP 以滑鼠／鍵盤原生事件操作 14 步：
// 台股搜尋、切週期、美股搜尋、假 AI 分析、庫存新增／健檢／重載／回訪／刪除。每步保存五鍵 before／after
// 原始字串、截圖、DOM 事實、同源 API 請求（含發起者堆疊與完成／失敗時刻）與 console 錯誤，
// 並分畫面／五鍵／console／請求四欄判定；請求逐筆分類（見 classifyRequest），不整批忽略取消。
// 服務期間持續監看有沒有本輪以外的用戶端連進 3000；一有就停服務、判本輪無效。
// 停止後核對就緒時監督程序底下的整棵程序樹（含 vercel 內部開發伺服器與看門程序）是否全部結束。
// 不打真行情（函式子程序在固定上游模式封鎖非本機連線）、不執行真 AI（claude CLI 一律換假 CLI）。
// exit 0＝全部通過；1＝有操作不符；2＝run 無效（身分、保護、清理或啟停失敗）。
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { claimRun, fileSha, sha256, sleep, toolVersions } from './service-kit.mjs';
import { ROOT, parseArgs, scanSecrets } from './verify-b1-breakdown.mjs';
import { launcherTree, listenerRows, nodeProcesses, processTable, runSentinel, scriptOf, startForeignMonitor } from './port-guard-03.mjs';

const require = createRequire(import.meta.url);
const { fixtureChartBody } = require('./trace-preload.cjs');
const { LOG: PERSISTENT_LOG } = require('./persistent-functions.cjs');

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const DAILY = path.join(TOOLS, 'daily-dev.mjs');
const STATE_FILE = path.join(process.env.LOCALAPPDATA, 'Temp', 'perf-opt-20260923', 'daily', 'state.json');
const DAILY_RUNTIME = path.dirname(STATE_FILE);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const RUNTIME_ROOT = path.join(process.env.LOCALAPPDATA, 'Temp', 'perf-opt-20260923');
// 正式 run 固定用日常預設埠；只有 --smoke 冒煙可改埠（main 起跑時決定，之後不變）。
let FRONT_PORT = 3000;
let API_PORT = 3001;
let ORIGIN = `http://localhost:${FRONT_PORT}`;
const KEYS = ['portfolio_items', 'portfolio_transactions_v1', 'portfolio_import_log_v1',
  'portfolio_realized_trades_v1', 'portfolio_snapshots_v1'];
const VIEWPORTS = {
  desktop: { width: 1280, height: 720, mobile: false },
  narrow: { width: 375, height: 812, mobile: true },
};
const CANDIDATE_FILES = [
  'api/_lib/clientAbort.ts', 'api/_lib/http.cancel.test.ts', 'api/_lib/http.ts', 'api/_lib/llm.ts',
  'api/_lib/yahoo.handshake.test.ts', 'api/_lib/yahoo.ts', 'api/finmind.ts', 'api/gemini-stream.test.ts',
  'api/gemini-stream.ts', 'api/gemini.ts', 'api/yahoo/chart.ts', 'api/yahoo/search.ts', 'vite.config.ts',
];
const TOOL_FILES = ['app-03.mjs', 'port-guard-03.mjs', 'daily-dev.mjs', 'persistent-functions.cjs',
  'trace-preload.cjs', 'service-kit.mjs'];
const FIXTURE_KINDS = ['yahoo-cookie', 'yahoo-crumb', 'yahoo-chart', 'yahoo-search', 'finmind', 'ratelimit'];
const WAIT_MS = 30_000;
const STABLE_MS = 2000;
const TW_FEE_RATE = 0.001425;   // config/twFeeRates.ts 的公定手續費率
const TW_STOCK_TAX = 0.003;     // 一般個股證交稅率（2330 為一般個股）
const US_BUY_DATE = '2026-09-01';
const EXPECTED_OPS = 14;

const fixturePrice = symbol => fixtureChartBody(symbol).chart.result[0].meta.regularMarketPrice;
const fixtureDate = (symbol, timeZone) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(fixtureChartBody(symbol).chart.result[0].timestamp.at(-1) * 1000));
const PRICES = {
  tw2330: fixturePrice('2330.TW'), tw2317: fixturePrice('2317.TW'), aapl: fixturePrice('AAPL'), fx: fixturePrice('USDTWD=X'),
};
const round2 = value => Math.round(value * 100) / 100;

// ── 事先寫定的合成持股與預期值（運算順序與 App 相同，才能逐字比對原始字串）──
function expectedUsLot(id) {
  const base = 500 * 1;
  const buyFee = parseFloat(String(Number((base * 0.0008).toFixed(2))));
  const total = base + buyFee;
  return { symbol: 'AAPL', avgCostPrice: total / 1, totalShares: 1, totalCost: 0, totalCostUSD: total,
    exchangeRate: parseFloat(String(Number(PRICES.fx.toFixed(3)))), purchaseCurrency: 'USD', isUsEtf: false,
    brokerDiscount: 10, buyFee, cashDividends: 0, stockDividends: 0, buyDate: US_BUY_DATE, id };
}
function expectedTwLot(id) {
  const base = 900 * 1000;
  const buyFee = parseFloat(String(Math.max(1, Math.floor(base * TW_FEE_RATE))));
  const total = base + buyFee;
  return { symbol: '2330', avgCostPrice: total / 1000, totalShares: 1000, totalCost: total, brokerDiscount: 10,
    buyFee, cashDividends: 0, stockDividends: 0, id };
}
function expectedUsTxn(lot) {
  const cost = lot.totalCostUSD;
  const fee = lot.buyFee;
  return { date: lot.buyDate, symbol: lot.symbol, name: lot.symbol, market: 'US', kind: 'buy',
    shares: lot.totalShares, price: (cost - fee) / lot.totalShares, gross: cost - fee, fee, tax: 0,
    exchangeRate: lot.exchangeRate, source: 'manual', key: `manual|lot|${lot.id}` };
}
function expectedUsRow(lot) {
  const value = PRICES.aapl * lot.totalShares;
  return { date: fixtureDate('AAPL', 'America/New_York'), market: 'US', source: 'live',
    marketValue: round2(value), totalCost: round2(lot.totalCostUSD), estSellCosts: round2(value * 0.0008),
    cashDividends: round2(0), fxRate: PRICES.fx, totalCostTwd: round2(lot.totalCostUSD * lot.exchangeRate),
    symbolCount: 1 };
}
function expectedTwRow(lot) {
  const value = PRICES.tw2330 * lot.totalShares;
  const sellFee = Math.max(1, Math.floor(value * TW_FEE_RATE));
  const tax = Math.floor(value * TW_STOCK_TAX);
  return { date: fixtureDate('2330.TW', 'Asia/Taipei'), market: 'TW', source: 'live', marketValue: value,
    totalCost: lot.totalCost, estSellCosts: sellFee + tax, cashDividends: 0, symbolCount: 1 };
}

// ── 五鍵差異判定：只讀＝逐字相同；寫入＝只准列出的鍵變，而且變化要等於預期 ──
const parse = raw => (raw === null ? null : JSON.parse(raw));
const withoutCapturedAt = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'capturedAt'));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function checkUnchanged(before, after, keys) {
  return Object.fromEntries(keys.map(key => [`${key} 逐字不變`, before[key] === after[key]]));
}

// 快照列：只排除寫入時刻 capturedAt，其餘欄位（含鍵順序）要等於預期；capturedAt 必須是數字。
function checkRows(raw, expectedRows, label) {
  let file = null;
  try { file = parse(raw); } catch { file = null; }
  const rows = file?.rows ?? null;
  const ok = file?.version === 1 && Array.isArray(rows) && rows.length === expectedRows.length
    && rows.every((row, index) => Number.isFinite(row.capturedAt)
      && sameJson(withoutCapturedAt(row), expectedRows[index]));
  return { [`${label}：列內容＝預期（僅 capturedAt 可變）`]: ok };
}

const RULES = {
  // 全新資料目錄第一次掛載：App 會把空庫存與空的已實現帳本寫回（既有行為），其他三鍵維持不存在。
  mountInit: ({ before, after }) => ({
    '開始前五鍵皆不存在（全新資料目錄）': KEYS.every(key => before?.[key] === null),
    'portfolio_items＝[]': after.portfolio_items === '[]',
    'portfolio_realized_trades_v1＝空帳本': after.portfolio_realized_trades_v1 === '{"version":1,"trades":[]}',
    ...checkUnchanged(before, after, ['portfolio_transactions_v1', 'portfolio_import_log_v1', 'portfolio_snapshots_v1']),
  }),
  readOnly: ({ before, after }) => checkUnchanged(before, after, KEYS),
  addUs: ({ before, after, context }) => {
    const added = (parse(after.portfolio_items) ?? []).at(-1);
    const lot = expectedUsLot(added?.id);
    context.usLot = added;
    return {
      'portfolio_items＝原清單＋一筆 AAPL（原始字串）': typeof added?.id === 'string' && /^\d+$/.test(added.id)
        && after.portfolio_items === JSON.stringify([...(parse(before.portfolio_items) ?? []), lot]),
      'portfolio_transactions_v1＝一筆手動買進流水（原始字串）': before.portfolio_transactions_v1 === null
        && after.portfolio_transactions_v1 === JSON.stringify({ version: 1, txns: [expectedUsTxn(lot)] }),
      ...checkRows(after.portfolio_snapshots_v1, [expectedUsRow(lot)], 'portfolio_snapshots_v1'),
      ...checkUnchanged(before, after, ['portfolio_import_log_v1', 'portfolio_realized_trades_v1']),
    };
  },
  addTw: ({ before, after, context }) => {
    const added = (parse(after.portfolio_items) ?? []).at(-1);
    const lot = expectedTwLot(added?.id);
    context.twLot = added;
    return {
      'portfolio_items＝原清單＋一筆 2330（原始字串）': typeof added?.id === 'string' && /^\d+$/.test(added.id)
        && after.portfolio_items === JSON.stringify([...(parse(before.portfolio_items) ?? []), lot]),
      ...checkRows(after.portfolio_snapshots_v1, [expectedTwRow(lot), expectedUsRow(context.usLot)], 'portfolio_snapshots_v1'),
      ...checkUnchanged(before, after, ['portfolio_transactions_v1', 'portfolio_import_log_v1', 'portfolio_realized_trades_v1']),
    };
  },
  // 回訪庫存：報價到齊後每日快照 effect 會重寫當日 live 列；只准 capturedAt 變。
  revisit: ({ before, after, context }) => ({
    ...checkRows(after.portfolio_snapshots_v1, [expectedTwRow(context.twLot), expectedUsRow(context.usLot)], 'portfolio_snapshots_v1'),
    ...checkUnchanged(before, after, ['portfolio_items', 'portfolio_transactions_v1', 'portfolio_import_log_v1',
      'portfolio_realized_trades_v1']),
  }),
  deleteUs: ({ before, after, context }) => ({
    'portfolio_items＝只剩 2330（原始字串）': after.portfolio_items === JSON.stringify([context.twLot]),
    'portfolio_transactions_v1＝移除該批流水後的空流水': after.portfolio_transactions_v1 === '{"version":1,"txns":[]}',
    ...checkRows(after.portfolio_snapshots_v1, [expectedTwRow(context.twLot)], 'portfolio_snapshots_v1（美股 live 列移除）'),
    ...checkUnchanged(before, after, ['portfolio_import_log_v1', 'portfolio_realized_trades_v1']),
  }),
  deleteTw: ({ before, after }) => ({
    'portfolio_items＝[]': after.portfolio_items === '[]',
    'portfolio_snapshots_v1＝空快照（台股 live 列移除）': after.portfolio_snapshots_v1 === '{"version":1,"rows":[]}',
    ...checkUnchanged(before, after, ['portfolio_transactions_v1', 'portfolio_import_log_v1', 'portfolio_realized_trades_v1']),
  }),
};

// 預期中的瀏覽器錯誤：headless Chrome 會自己要 /favicon.ico，Vite 回 404；與產品無關，另列不計。
const isExpectedConsole = event => event.kind === 'log.network' && /\/favicon\.ico\b/.test(event.text);

// 共同驗收協定 §4 的請求例外：同 symbol／週期的 10y 已先成功，App 依設計中止仍未回來的 2y
// （services/yahoo.ts 的 finish()）；中止可能發生在收到標頭前（無狀態）或標頭後（200）。
// 原始錯誤照記；只有同一步內找得到「更早完成的 10y 200」才排除。
function designedAbortOf(request, requests) {
  const match = request.route.match(/^\/api\/yahoo\/chart\?symbol=([^&]+)&interval=([^&]+)&range=2y$/);
  if (!match || request.method !== 'GET' || ![null, 200].includes(request.status) || request.failed?.canceled !== true
    || request.failed.error !== 'net::ERR_ABORTED' || !Number.isFinite(request.failedAtMs)) return null;
  const winner = requests.find(other => other.method === 'GET'
    && other.route === `/api/yahoo/chart?symbol=${match[1]}&interval=${match[2]}&range=10y`
    && other.status === 200 && !other.failed && Number.isFinite(other.finishedAtMs) && other.finishedAtMs <= request.failedAtMs);
  return winner ? { rule: '協定 §4：10y 先完成後被取代的 2y', aborted: request.route, winner: winner.route,
    winnerFinishedAtMs: winner.finishedAtMs, abortedAtMs: request.failedAtMs } : null;
}

// 請求分類（本輪判定器規則，逐筆記錄類別，不整批忽略）：
// - 瀏覽器自發（發起者不是頁面腳本，例如對 stale-while-revalidate 回應的背景重新驗證）：不算 App 請求，
//   另列；若拿到 4xx／5xx 仍算失敗。
// - App 發起：HTTP 必須 200／204；§4 的 2y 例外可無回應。200 之後的傳輸層取消只有一種可接受——
//   /api/gemini-stream 且本步畫面已證明完整收到 done（streamComplete）；其餘一律失敗。
function classifyRequest(request, requests, streamComplete) {
  if (request.initiator && request.initiator.type !== 'script') {
    const ok = request.status === null || [200, 204, 304].includes(request.status);
    return { kind: request.failed ? '瀏覽器自發・已取消' : '瀏覽器自發', ok };
  }
  if (designedAbortOf(request, requests)) return { kind: '§4 設計內 2y 取消', ok: true };
  if (![200, 204].includes(request.status)) return { kind: 'HTTP 失敗或無回應', ok: false };
  if (!request.failed) return { kind: '成功', ok: true };
  if (request.method === 'POST' && request.route === '/api/gemini-stream' && streamComplete) {
    return { kind: '串流完整送達後的傳輸層取消', ok: true };
  }
  return { kind: '200 之後被取消', ok: false };
}

// ── 最小 CDP 用戶端（Node 內建 WebSocket）──
class Cdp {
  static async connect(url) {
    const cdp = new Cdp(url);
    await new Promise((resolve, reject) => {
      cdp.ws.addEventListener('open', resolve, { once: true });
      cdp.ws.addEventListener('error', () => reject(new Error(`CDP 連線失敗：${url}`)), { once: true });
    });
    return cdp;
  }
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, method } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${method}：${message.error.message}`));
        else resolve(message.result);
      } else if (message.method) {
        for (const handler of this.listeners.get(message.method) ?? []) handler(message.params);
      }
    });
  }
  send(method, params = {}, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 逾時`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, handler) {
    const list = this.listeners.get(method) ?? [];
    list.push(handler);
    this.listeners.set(method, list);
  }
  close() { try { this.ws.close(); } catch { /* 已關閉 */ } }
}

// 在頁面執行一個自足函式（不在頁面留下全域變數）。
async function pageCall(cdp, fn, arg = null) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${JSON.stringify(arg)})`,
    returnByValue: true, awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`頁面執行失敗：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  }
  return result.result.value;
}

const snapshotKeys = keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));

// 頁面狀態：只取驗收需要的可見事實，不讀其他 storage。
function pageFacts() {
  const clean = value => (value ?? '').replace(/\s+/g, ' ').trim();
  const shown = el => Boolean(el) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const buttons = [...document.querySelectorAll('button')].filter(shown);
  const aiButton = buttons.find(button => clean(button.textContent) === 'AI 分析');
  let quote = null;
  if (aiButton) {
    let card = aiButton.parentElement;
    while (card && !card.querySelector('p.text-3xl')) card = card.parentElement;
    if (card) {
      const texts = [...card.querySelectorAll('p')].map(p => clean(p.textContent));
      quote = { name: texts[0] ?? null, symbol: texts[1] ?? null, price: clean(card.querySelector('p.text-3xl')?.textContent) };
    }
  }
  const intervals = ['15分', '1時', '日', '週', '月'];
  const pressed = buttons.filter(button => intervals.includes(clean(button.textContent))
    && button.getAttribute('aria-pressed') === 'true').map(button => clean(button.textContent));
  const chartSvgs = [...document.querySelectorAll('.recharts-wrapper svg.recharts-surface')].filter(shown);
  const loadingChart = [...document.querySelectorAll('span')].some(span => shown(span) && clean(span.textContent) === '載入 K 線中…');
  const analysisTitle = [...document.querySelectorAll('h2')].find(h2 => shown(h2) && clean(h2.textContent) === 'AI 技術分析報告');
  let analysis = null;
  if (analysisTitle) {
    let card = analysisTitle.parentElement;
    while (card && card.parentElement && !card.querySelector('.p-8')) card = card.parentElement;
    analysis = clean(card?.innerText).slice(0, 600);
  }
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(shown).map(dialog => ({
    label: dialog.getAttribute('aria-label'), text: clean(dialog.innerText).slice(0, 600),
  }));
  const holdingsHeader = [...document.querySelectorAll('h2')].some(h2 => shown(h2) && clean(h2.textContent) === '我的庫存');
  const emptyHoldings = [...document.querySelectorAll('h3')].some(h3 => shown(h3) && clean(h3.textContent) === '尚無持股紀錄');
  const holdingRows = [...document.querySelectorAll('table tbody tr')].filter(shown)
    .map(row => [...row.querySelectorAll('td')].map(td => clean(td.innerText)))
    .filter(cells => cells.length > 3 && cells[0] !== '明細')
    .map(cells => ({ symbol: (cells[1] ?? '').split(' ')[0], cells }));
  const fxText = [...document.querySelectorAll('p, span, div')].map(el => clean(el.textContent))
    .find(text => /^USD\/TWD [\d,.]+$/.test(text)) ?? null;
  return {
    url: location.href, visibility: document.visibilityState,
    viewport: { width: innerWidth, height: innerHeight },
    quote, aiButtonDisabled: aiButton ? Boolean(aiButton.disabled) : null,
    pressedIntervals: pressed, chartSvgCount: chartSvgs.length, loadingChart,
    analysis, dialogs, holdingsHeader, emptyHoldings, holdingRows, fxText,
  };
}

// 找到符合條件的元素、捲到視窗中央，回傳中心座標；同時確認該點最上層就是它（沒有被遮住）。
function locate(query) {
  const clean = value => (value ?? '').replace(/\s+/g, ' ').trim();
  const shown = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  let candidates = [...document.querySelectorAll(query.selector)].filter(shown);
  if (query.within) {
    const scope = [...document.querySelectorAll(query.within.selector)].filter(shown)
      .find(el => clean(el.textContent).includes(query.within.text));
    candidates = scope ? candidates.filter(el => scope.contains(el)) : [];
  }
  if (query.text !== undefined) {
    candidates = candidates.filter(el => (query.exact ? clean(el.textContent) === query.text
      : clean(el.textContent).includes(query.text)));
  }
  const el = candidates[query.index ?? 0];
  if (!el) return { found: false, count: candidates.length };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const top = document.elementFromPoint(x, y);
  return { found: true, x, y, onTop: Boolean(top && (top === el || el.contains(top))),
    tag: el.tagName.toLowerCase(), text: clean(el.textContent).slice(0, 80), disabled: Boolean(el.disabled) };
}

function focusAndSelect(query) {
  const el = [...document.querySelectorAll(query.selector)].find(item => item.getClientRects().length > 0);
  if (!el) return false;
  el.focus();
  if (typeof el.select === 'function') el.select();
  return document.activeElement === el;
}

// React 受控的 date 欄位：鍵盤輸入受語系影響，改用原生 value setter＋input 事件（等同日期選擇器送出）。
function setNativeValue(query) {
  const el = [...document.querySelectorAll(query.selector)].find(item => item.getClientRects().length > 0);
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, query.value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value === query.value;
}

function inputValue(query) {
  const el = [...document.querySelectorAll(query.selector)].find(item => item.getClientRects().length > 0);
  return el ? el.value : null;
}

// 截圖前把要看的區塊捲進畫面（只捲動，不改任何狀態）。
function reveal(query) {
  const clean = value => (value ?? '').replace(/\s+/g, ' ').trim();
  if (query === 'top') {
    window.scrollTo(0, 0);
    document.querySelectorAll('main').forEach(main => main.scrollTo(0, 0));
    return true;
  }
  const el = [...document.querySelectorAll(query.selector)]
    .find(item => item.getClientRects().length > 0 && (!query.text || clean(item.textContent).includes(query.text)));
  if (!el) return false;
  el.scrollIntoView({ block: 'start' });
  return true;
}

// ── 小工具 ──
const nowIso = () => new Date().toISOString();
const execText = (file, args, options = {}) => new Promise(resolve => {
  execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024, ...options },
    (error, stdout, stderr) => {
      resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout).trim(),
        stderr: String(stderr).trim() });
    });
});
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
// 請求的發起者：同步堆疊加非同步父堆疊，只留本專案原始碼的函式名與路徑／行號（去掉 origin 與 ?t= 版本參數）。
function initiatorOf(initiator) {
  const frames = [];
  for (let stack = initiator?.stack; stack && frames.length < 14; stack = stack.parent) {
    for (const frame of stack.callFrames ?? []) {
      let file = frame.url;
      try { file = new URL(frame.url).pathname; } catch { /* 非 URL 保留原字 */ }
      if (!file || /node_modules|\/@vite\/|\/\.vite\//.test(file)) continue;
      frames.push(`${frame.functionName || '(匿名)'}@${file}:${frame.lineNumber + 1}`);
      if (frames.length >= 14) break;
    }
  }
  return { type: initiator?.type ?? null, frames };
}

function routeOf(rawUrl) {
  const url = new URL(rawUrl);
  const kept = ['symbol', 'interval', 'range', 'dataset', 'data_id', 'q']
    .filter(key => url.searchParams.has(key)).map(key => `${key}=${url.searchParams.get(key)}`);
  return kept.length ? `${url.pathname}?${kept.join('&')}` : url.pathname;
}

// ── 日常入口（固定資料模式）──
async function startDaily(runtimeDir, raw) {
  const traceDir = path.join(runtimeDir, 'trace');
  fs.mkdirSync(traceDir);
  const controlPath = path.join(runtimeDir, 'control.json');
  fs.writeFileSync(controlPath, JSON.stringify({ version: 'app03-v1', clockOffsetMs: 0, script: {}, delayMs: {}, ai: {} }));
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'NODE_OPTIONS' || /^PERF0[13]_/.test(key)) delete env[key];
  }
  const testEnv = {
    PERF03_FIXED_TEST: '1', PERF01_FIXTURE: '1', PERF01_FIXTURE_DELAY_MS: '50',
    PERF01_TRACE_DIR: traceDir.split(path.sep).join('/'), PERF01_FIXTURE_CONTROL: controlPath.split(path.sep).join('/'),
    PERF03_TEST_APP: '1', PERF03_TEST_CLI: '1',
  };
  Object.assign(env, testEnv);
  raw.launcher.testEnvNames = Object.keys(testEnv);
  const logFile = path.join(runtimeDir, 'daily-start.log');
  const fd = fs.openSync(logFile, 'a');
  const started = performance.now();
  // 正式 run 用日常命令原樣（不帶埠參數＝3000／3001）；冒煙才指定其他埠。
  const portArgs = FRONT_PORT === 3000 && API_PORT === 3001 ? []
    : ['--front-port', String(FRONT_PORT), '--api-port', String(API_PORT)];
  raw.launcher.command = ['node', '.scratch/performance-optimization-20260923/tools/daily-dev.mjs', 'start', ...portArgs].join(' ');
  const child = spawn(process.execPath, [DAILY, 'start', ...portArgs], { cwd: ROOT, env, stdio: ['ignore', fd, fd], windowsHide: true });
  fs.closeSync(fd);
  const exit = { value: null };
  child.once('exit', (code, signal) => { exit.value = { code, signal }; });
  while (performance.now() - started < 120_000) {
    if (fs.readFileSync(logFile, 'utf8').includes('日常入口已就緒') || exit.value) break;
    await sleep(250);
  }
  const output = fs.readFileSync(logFile, 'utf8').trim();
  raw.launcher.startOutput = output.split(/\r?\n/);
  raw.launcher.readyMs = Math.round(performance.now() - started);
  if (!output.includes('日常入口已就緒')) {
    throw new Error(`日常入口未就緒：${exit.value ? `監督程序結束 ${JSON.stringify(exit.value)}` : '逾時'}`);
  }
  return { child, traceDir, exit };
}

function ownedState() {
  const state = readJson(STATE_FILE);
  if (!state || state.frontPort !== FRONT_PORT || state.apiPort !== API_PORT) throw new Error('日常入口狀態與受測埠不符');
  return {
    token: state.token,
    view: {
      supervisorPid: state.supervisorPid, supervisorCreationDate: state.supervisorCreationDate,
      children: state.children.map(({ pid, script, creationDate }) => ({ pid, script: path.basename(script), creationDate })),
      watchdog: state.watchdog ? { pid: state.watchdog.pid, creationDate: state.watchdog.creationDate } : null,
      treeCount: Array.isArray(state.tree) ? state.tree.length : null,
    },
  };
}

// ── Chrome（全新資料目錄）──
async function launchChrome(profileDir, viewport) {
  if (fs.existsSync(profileDir)) throw new Error('瀏覽器資料目錄已存在，拒絕重用');
  fs.mkdirSync(profileDir);
  const args = [`--user-data-dir=${profileDir}`, '--headless=new', '--remote-debugging-port=0', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-component-update', '--disable-sync',
    '--disable-background-networking', '--disable-default-apps', '--mute-audio',
    `--window-size=${viewport.width},${viewport.height}`, 'about:blank'];
  const child = spawn(CHROME, args, { stdio: 'ignore', windowsHide: true });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const started = performance.now();
  while (!fs.existsSync(portFile) || !fs.readFileSync(portFile, 'utf8').trim()) {
    if (performance.now() - started > 20_000) throw new Error('Chrome 未回報除錯埠');
    await sleep(100);
  }
  const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  if (!page) throw new Error('找不到 Chrome 分頁');
  return { child, pid: child.pid, version: version.Browser, browserWs: version.webSocketDebuggerUrl, pageWs: page.webSocketDebuggerUrl };
}

async function closeChrome(chrome) {
  try {
    const browser = await Cdp.connect(chrome.browserWs);
    await browser.send('Browser.close').catch(() => {});
    browser.close();
  } catch { /* 已關閉 */ }
  const started = performance.now();
  while (performance.now() - started < 10_000) {
    if (chrome.child.exitCode !== null || chrome.child.signalCode !== null) return true;
    await sleep(100);
  }
  await execText('taskkill', ['/PID', String(chrome.pid), '/T', '/F']);
  return false;
}

// ── 一個視窗尺寸的完整操作序列 ──
async function runViewport({ name, viewport, runtimeDir, evidenceDir, chromePids, abortSignal }) {
  const profileDir = path.join(runtimeDir, `profile-${name}`);
  const chrome = await launchChrome(profileDir, viewport);
  chromePids.add(chrome.pid);
  const record = { name, viewport, profileDir: path.basename(profileDir), chrome: { pid: chrome.pid, version: chrome.version },
    ops: [], finalKeys: null, closedCleanly: null, profileRemoved: null };
  const cdp = await Cdp.connect(chrome.pageWs);
  const network = new Map();
  const consoleEvents = [];
  const externalHosts = new Set();
  cdp.on('Network.requestWillBeSent', params => {
    const url = params.request.url;
    if (!/^https?:/.test(url)) return;
    const host = new URL(url).host;
    if (host !== `localhost:${FRONT_PORT}`) externalHosts.add(host);
    network.set(params.requestId, { at: performance.now(), method: params.request.method, url, status: null, failed: null,
      finishedAtMs: null, failedAtMs: null,
      initiator: new URL(url).pathname.startsWith('/api/') ? initiatorOf(params.initiator) : null });
  });
  cdp.on('Network.responseReceived', params => {
    const entry = network.get(params.requestId);
    if (entry) entry.status = params.response.status;
  });
  // 完成／失敗時刻用瀏覽器的單調時鐘（同一時鐘才可比先後），供 §4 例外核對 10y 是否先完成。
  cdp.on('Network.loadingFinished', params => {
    const entry = network.get(params.requestId);
    if (entry) entry.finishedAtMs = Math.round(params.timestamp * 1e6) / 1e3;
  });
  cdp.on('Network.loadingFailed', params => {
    const entry = network.get(params.requestId);
    if (!entry) return;
    entry.failed = { error: params.errorText, canceled: Boolean(params.canceled) };
    entry.failedAtMs = Math.round(params.timestamp * 1e6) / 1e3;
  });
  cdp.on('Runtime.consoleAPICalled', params => {
    if (!['error', 'assert'].includes(params.type)) return;
    consoleEvents.push({ at: performance.now(), kind: `console.${params.type}`,
      text: params.args.map(arg => arg.value ?? arg.description ?? '').join(' ').slice(0, 400) });
  });
  cdp.on('Runtime.exceptionThrown', params => {
    consoleEvents.push({ at: performance.now(), kind: 'exception',
      text: (params.exceptionDetails.exception?.description ?? params.exceptionDetails.text ?? '').slice(0, 400) });
  });
  cdp.on('Log.entryAdded', params => {
    if (params.entry.level !== 'error') return;
    consoleEvents.push({ at: performance.now(), kind: `log.${params.entry.source}`,
      text: `${params.entry.text ?? ''} ${params.entry.url ?? ''}`.trim().slice(0, 400) });
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // 讓請求發起者帶非同步父堆疊（await 鏈），被取消的請求才能對到發起它的程式路徑。
  await cdp.send('Runtime.setAsyncCallStackDepth', { maxDepth: 16 });
  await cdp.send('Network.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile,
  });
  // 文件開始時（App 程式執行前）記錄五鍵，作為「開啟 App」這一步的 before；只在受測來源上讀。
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `if (location.origin === ${JSON.stringify(ORIGIN)}) { try { window.__perf03DocStart = (${snapshotKeys.toString()})(${JSON.stringify(KEYS)}); } catch (error) { window.__perf03DocStart = { error: String(error) }; } }`,
  });

  const context = {};
  const facts = () => pageCall(cdp, pageFacts);
  const keys = () => pageCall(cdp, snapshotKeys, KEYS);
  const waitFor = async (label, predicate, timeoutMs = WAIT_MS) => {
    const started = performance.now();
    let last = null;
    while (performance.now() - started < timeoutMs) {
      if (abortSignal.aborted) throw new Error('外部用戶端出現，已中止');
      try {
        last = await facts();
        if (predicate(last)) return last;
      } catch (error) {
        last = { error: error.message };
      }
      await sleep(150);
    }
    throw new Error(`等待逾時：${label}；最後狀態 ${JSON.stringify(last).slice(0, 600)}`);
  };
  const waitValue = async (label, selector) => {
    const started = performance.now();
    while (performance.now() - started < WAIT_MS) {
      const value = await pageCall(cdp, inputValue, { selector });
      if (value) return value;
      await sleep(150);
    }
    throw new Error(`等待逾時：${label}`);
  };
  // 五鍵連續 STABLE_MS 不變才算落定（涵蓋 800 ms debounce 的每日快照 effect）。
  const settleKeys = async () => {
    let current = await keys();
    let since = performance.now();
    const started = performance.now();
    while (performance.now() - started < 20_000) {
      await sleep(250);
      const next = await keys();
      if (!sameJson(next, current)) { current = next; since = performance.now(); continue; }
      if (performance.now() - since >= STABLE_MS) return current;
    }
    throw new Error('五鍵 20 秒內未落定');
  };
  const click = async (query, { allowDisabled = false } = {}) => {
    let target = await pageCall(cdp, locate, query);
    if (!target.found) throw new Error(`找不到可點元素：${JSON.stringify(query)}（候選 ${target.count}）`);
    await sleep(120);
    target = await pageCall(cdp, locate, query);
    if (!target.found || !target.onTop) throw new Error(`元素不存在或被遮住：${JSON.stringify(query)}`);
    if (target.disabled && !allowDisabled) throw new Error(`元素停用中：${JSON.stringify(query)}`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    return target;
  };
  const waitClickable = async (label, query) => {
    const started = performance.now();
    while (performance.now() - started < WAIT_MS) {
      const target = await pageCall(cdp, locate, query);
      if (target.found) return target;
      await sleep(150);
    }
    throw new Error(`等待逾時：${label}`);
  };
  const type = async (selector, text) => {
    await click({ selector });
    if (!await pageCall(cdp, focusAndSelect, { selector })) throw new Error(`無法聚焦：${selector}`);
    await cdp.send('Input.insertText', { text });
  };
  const pressEnter = async () => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };

  const priceText = value => value.toFixed(2);
  const chartReady = (f, symbol) => f.quote?.symbol === symbol && !f.loadingChart && f.chartSvgCount > 0;
  const rowOf = (f, symbol) => f.holdingRows.find(row => row.symbol === symbol);
  const usPriceShown = f => rowOf(f, 'AAPL')?.cells.some(cell => cell.includes(priceText(PRICES.aapl))) ?? false;
  const twPriceShown = f => rowOf(f, '2330')?.cells.some(cell => cell === priceText(PRICES.tw2330)) ?? false;
  const fxShown = f => f.fxText === `USD/TWD ${PRICES.fx.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fivePieces = text => /假片段1.*假片段2.*假片段3.*假片段4.*假片段5/.test(text ?? '');
  // 完整收到串流 done：五段齊全，且沒有前端在缺 done 時附加的「報告生成中斷」字樣（services/gemini.ts）。
  const completeStream = text => fivePieces(text) && !(text ?? '').includes('報告生成中斷');
  const holdingsTable = { selector: 'table' };

  const ops = [
    {
      id: 'open-app', label: '開啟 App（預設台股 2330 日線）', rule: 'mountInit', docStartBefore: true, reveal: 'top',
      act: async () => {
        await cdp.send('Page.navigate', { url: `${ORIGIN}/` });
        return waitFor('預設 2330 K 線', f => chartReady(f, '2330.TW') && f.quote.price === priceText(PRICES.tw2330)
          && f.pressedIntervals.join() === '日');
      },
      checks: f => ({ '標頭為 2330.TW 固定價': f.quote?.symbol === '2330.TW' && f.quote.price === priceText(PRICES.tw2330),
        '有效 K 線（非骨架）': f.chartSvgCount > 0 && !f.loadingChart, '頁面可見': f.visibility === 'visible' }),
      requests: ['/api/yahoo/chart?symbol=2330.TW&interval=1d'],
    },
    {
      id: 'search-tw-2317', label: '搜尋台股 2317 並點選名錄結果', rule: 'readOnly', reveal: 'top',
      act: async () => {
        await type('input[role="combobox"]', '2317');
        const option = await waitClickable('名錄下拉出現 2317', { selector: 'li[role="option"]', text: '2317' });
        context.optionText = option.text;
        await click({ selector: 'li[role="option"]', text: '2317' });
        return waitFor('2317 K 線', f => chartReady(f, '2317.TW') && f.quote.price === priceText(PRICES.tw2317));
      },
      checks: f => ({ '下拉選項為固定名錄 2317 固定資料鴻海': /2317.*固定資料鴻海/.test(context.optionText ?? ''),
        '標頭為 2317.TW 固定價': f.quote?.symbol === '2317.TW' && f.quote.price === priceText(PRICES.tw2317),
        '有效 K 線（非骨架）': f.chartSvgCount > 0 && !f.loadingChart }),
      requests: ['/api/yahoo/chart?symbol=2317.TW&interval=1d'],
    },
    {
      id: 'interval-tw-week', label: '台股切換週線', rule: 'readOnly', reveal: 'top',
      act: async () => {
        await click({ selector: 'button', text: '週', exact: true });
        return waitFor('週線 K 線', f => f.pressedIntervals.join() === '週' && chartReady(f, '2317.TW'));
      },
      checks: f => ({ '週線按鈕為選取狀態': f.pressedIntervals.join() === '週',
        '有效 K 線（非骨架）': f.chartSvgCount > 0 && !f.loadingChart }),
      requests: ['/api/yahoo/chart?symbol=2317.TW&interval=1wk'],
    },
    {
      id: 'search-us-aapl', label: '輸入美股 AAPL 後按 Enter', rule: 'readOnly', reveal: 'top',
      act: async () => {
        await type('input[role="combobox"]', 'AAPL');
        await pressEnter();
        return waitFor('AAPL K 線', f => chartReady(f, 'AAPL') && f.quote.price === priceText(PRICES.aapl));
      },
      checks: f => ({ '標頭為 AAPL 固定價': f.quote?.symbol === 'AAPL' && f.quote.price === priceText(PRICES.aapl),
        '沿用週線週期': f.pressedIntervals.join() === '週', '有效 K 線（非骨架）': f.chartSvgCount > 0 && !f.loadingChart }),
      requests: ['/api/yahoo/chart?symbol=AAPL&interval=1wk'],
    },
    {
      id: 'interval-us-day', label: '美股切回日線', rule: 'readOnly', reveal: 'top',
      act: async () => {
        await click({ selector: 'button', text: '日', exact: true });
        return waitFor('AAPL 日線', f => f.pressedIntervals.join() === '日' && chartReady(f, 'AAPL'));
      },
      checks: f => ({ '日線按鈕為選取狀態': f.pressedIntervals.join() === '日',
        '有效 K 線（非骨架）': f.chartSvgCount > 0 && !f.loadingChart }),
      requests: ['/api/yahoo/chart?symbol=AAPL&interval=1d'],
    },
    {
      id: 'ai-analysis-fake', label: '美股 AAPL 假 AI 技術分析（空手、快捷）', rule: 'readOnly',
      reveal: { selector: 'h2', text: 'AI 技術分析報告' },
      act: async () => {
        await click({ selector: 'button', text: 'AI 分析', exact: true });
        await waitFor('分析參數視窗', f => f.dialogs.some(d => d.label === 'AI 分析參數設定'));
        await click({ selector: 'button', text: '空手', exact: true });
        await click({ selector: 'button', text: '開始 AI 智能分析', exact: true });
        return waitFor('假 AI 五段完成', f => fivePieces(f.analysis) && !f.dialogs.length && f.aiButtonDisabled === false);
      },
      checks: f => ({ '報告依序出現假片段1～5且無中斷字樣': completeStream(f.analysis),
        '分析結束（AI 分析鈕恢復可按）': f.aiButtonDisabled === false, '標頭仍為 AAPL': f.quote?.symbol === 'AAPL' }),
      streamEvidence: f => completeStream(f.analysis),
      requests: ['POST /api/gemini-stream'],
    },
    {
      id: 'open-portfolio', label: '切到我的庫存（空庫存）', rule: 'readOnly', reveal: 'top',
      act: async () => {
        await click({ selector: 'button', text: '我的庫存', exact: true });
        return waitFor('空庫存畫面', f => f.holdingsHeader && f.emptyHoldings);
      },
      checks: f => ({ '顯示尚無持股紀錄': f.emptyHoldings }),
    },
    {
      id: 'add-us-aapl', label: '新增合成美股 AAPL 1 股、均價 500 USD、買進日 2026-09-01', rule: 'addUs', reveal: holdingsTable,
      act: async () => {
        await click({ selector: 'button', text: '新增持股', exact: true });
        await waitFor('新增持股視窗', f => f.dialogs.some(d => d.label === '新增持股'));
        await type('input[placeholder="台股：2330 ／ 美股：AAPL, SPY"]', 'AAPL');
        context.formRate = await waitValue('買入匯率自動帶入', 'input[type="number"][step="0.001"]');
        await type('input[placeholder="例：185.50"]', '500');
        await type('input[placeholder="例：100"]', '1');
        if (!await pageCall(cdp, setNativeValue, { selector: 'input[type="date"]', value: US_BUY_DATE })) {
          throw new Error('買進日期欄位寫入失敗');
        }
        context.formFee = await waitValue('手續費自動試算', 'input[type="number"][step="0.01"]');
        await click({ selector: 'button', text: '確認新增', exact: true });
        return waitFor('AAPL 列顯示固定價與匯率', f => !f.dialogs.length && usPriceShown(f) && fxShown(f));
      },
      checks: f => ({ '表單匯率預設為固定匯率 945': context.formRate === String(Number(PRICES.fx.toFixed(3))),
        '手續費自動試算 0.4': context.formFee === '0.4', 'AAPL 列顯示固定價 588.00': usPriceShown(f),
        '顯示固定 USD/TWD 945.00': fxShown(f) }),
      requests: ['/api/yahoo/chart?symbol=USDTWD=X'],
    },
    {
      id: 'add-tw-2330', label: '新增合成台股 2330 1000 股、均價 900（不填買進日）', rule: 'addTw', reveal: holdingsTable,
      act: async () => {
        await click({ selector: 'button', text: '新增持股', exact: true });
        await waitFor('新增持股視窗', f => f.dialogs.some(d => d.label === '新增持股'));
        await type('input[placeholder="台股：2330 ／ 美股：AAPL, SPY"]', '2330');
        await type('input[placeholder="例：500.5"]', '900');
        await type('input[placeholder="例：100"]', '1000');
        context.twFee = await waitValue('台股手續費自動試算', 'input[type="number"][step="0.01"]');
        await click({ selector: 'button', text: '確認新增', exact: true });
        return waitFor('2330 列顯示固定價', f => !f.dialogs.length && twPriceShown(f) && usPriceShown(f));
      },
      checks: f => ({ '台股手續費自動試算 1282': context.twFee === '1282', '2330 列顯示固定價 901.00': twPriceShown(f),
        'AAPL 列仍顯示固定價': usPriceShown(f) }),
    },
    {
      id: 'health-check-aapl', label: 'AAPL 單筆假 AI 健檢（結果視窗保持開啟供截圖）', rule: 'readOnly',
      act: async () => {
        await click({ selector: 'button[title="健檢"]', within: { selector: 'tr', text: 'AAPL' } });
        const done = await waitFor('健檢假片段完成', f => f.dialogs.some(d => d.label === '持股健檢：AAPL'
          && fivePieces(d.text) && !d.text.includes('產生中') && !d.text.includes('AI 思考中')));
        context.healthText = done.dialogs.find(d => d.label === '持股健檢：AAPL')?.text ?? null;
        return done;
      },
      checks: f => ({ '健檢內容為假片段1～5且無中斷字樣': completeStream(context.healthText),
        '健檢視窗仍顯示結果': f.dialogs.some(d => d.label === '持股健檢：AAPL'),
        '持股兩列仍在': usPriceShown(f) && twPriceShown(f) }),
      streamEvidence: () => completeStream(context.healthText),
      requests: ['POST /api/gemini-stream'],
    },
    {
      id: 'reload-app', label: '重新整理頁面（回到預設市場分析）', rule: 'readOnly', reveal: 'top',
      act: async () => {
        await cdp.send('Page.reload', { ignoreCache: false });
        return waitFor('重載後 2330 K 線', f => chartReady(f, '2330.TW') && f.quote.price === priceText(PRICES.tw2330)
          && !f.dialogs.length);
      },
      checks: f => ({ '重載後顯示預設 2330.TW': f.quote?.symbol === '2330.TW',
        '有效 K 線（非骨架）': f.chartSvgCount > 0 && !f.loadingChart }),
    },
    {
      id: 'revisit-portfolio', label: '回訪我的庫存（報價與當日快照重算）', rule: 'revisit', reveal: holdingsTable,
      act: async () => {
        await click({ selector: 'button', text: '我的庫存', exact: true });
        return waitFor('回訪兩列顯示固定價', f => usPriceShown(f) && twPriceShown(f) && fxShown(f));
      },
      checks: f => ({ '兩檔持股都顯示固定價': usPriceShown(f) && twPriceShown(f), '顯示固定 USD/TWD': fxShown(f) }),
    },
    {
      id: 'delete-us-aapl', label: '刪除合成 AAPL 持股（展開→垃圾桶→確認）', rule: 'deleteUs', reveal: holdingsTable,
      act: async () => {
        await click({ selector: 'td', text: 'AAPL', within: { selector: 'tr', text: 'AAPL' } });
        const lotRow = { selector: 'tr', text: '買入:USD' };
        await waitClickable('AAPL 明細刪除鈕', { selector: 'td:last-child button:last-child', within: lotRow });
        await click({ selector: 'td:last-child button:last-child', within: lotRow });
        await waitClickable('AAPL 刪除確認鈕', { selector: 'button', text: '確認', exact: true, within: lotRow });
        await click({ selector: 'button', text: '確認', exact: true, within: lotRow });
        return waitFor('AAPL 列消失', f => !rowOf(f, 'AAPL') && twPriceShown(f));
      },
      checks: f => ({ 'AAPL 列已移除': !rowOf(f, 'AAPL'), '2330 列仍顯示固定價': twPriceShown(f) }),
    },
    {
      id: 'delete-tw-2330', label: '刪除合成 2330 持股（展開→垃圾桶→確認）', rule: 'deleteTw', reveal: 'top',
      act: async () => {
        await click({ selector: 'td', text: '2330', within: { selector: 'tr', text: '2330' } });
        const lotRow = { selector: 'tr', text: '明細' };
        await waitClickable('2330 明細刪除鈕', { selector: 'td:last-child button:last-child', within: lotRow });
        await click({ selector: 'td:last-child button:last-child', within: lotRow });
        await waitClickable('2330 刪除確認鈕', { selector: 'button', text: '確認', exact: true, within: lotRow });
        await click({ selector: 'button', text: '確認', exact: true, within: lotRow });
        return waitFor('回到空庫存', f => f.emptyHoldings && !f.holdingRows.length);
      },
      checks: f => ({ '回到尚無持股紀錄': f.emptyHoldings }),
    },
  ];

  const screensDir = path.join(evidenceDir, 'screens');
  fs.mkdirSync(screensDir, { recursive: true });
  try {
    for (const [index, op] of ops.entries()) {
      if (abortSignal.aborted) throw new Error('外部用戶端出現，已中止');
      const opRecord = { id: op.id, label: op.label, rule: op.rule, startedAt: nowIso(), before: null, after: null,
        docStart: null, facts: null, checks: {}, keyChecks: {}, requests: [], console: [], expectedConsole: [],
        screenshot: null, error: null };
      record.ops.push(opRecord);
      const opStart = performance.now();
      const consoleFrom = consoleEvents.length;
      try {
        opRecord.before = op.docStartBefore ? null : await settleKeys();
        await op.act();
        if (op.docStartBefore || op.id === 'reload-app') {
          opRecord.docStart = await pageCall(cdp, () => window.__perf03DocStart ?? null);
          if (op.docStartBefore) opRecord.before = opRecord.docStart;
        }
        opRecord.after = await settleKeys();
        opRecord.facts = await facts();
        opRecord.checks = op.checks(opRecord.facts);
        opRecord.checks['頁面來源為 http://localhost:3000'] = opRecord.facts.url.startsWith(`${ORIGIN}/`);
        opRecord.keyChecks = RULES[op.rule]({ before: opRecord.before, after: opRecord.after, context });
        if (op.id === 'reload-app') opRecord.keyChecks['文件開始時五鍵＝重載前'] = sameJson(opRecord.docStart, opRecord.before);
      } catch (error) {
        opRecord.error = error.message;
      }
      opRecord.durationMs = Math.round(performance.now() - opStart);
      opRecord.requests = [...network.values()]
        .filter(entry => entry.at >= opStart && new URL(entry.url).pathname.startsWith('/api/'))
        .map(entry => ({ method: entry.method, route: routeOf(entry.url), status: entry.status, failed: entry.failed,
          finishedAtMs: entry.finishedAtMs, failedAtMs: entry.failedAtMs, initiator: entry.initiator }));
      opRecord.designedAborts = opRecord.requests.map(request => designedAbortOf(request, opRecord.requests)).filter(Boolean);
      const streamComplete = Boolean(op.streamEvidence && !opRecord.error && op.streamEvidence(opRecord.facts ?? {}));
      for (const request of opRecord.requests) Object.assign(request, classifyRequest(request, opRecord.requests, streamComplete));
      opRecord.badRequests = opRecord.requests.filter(request => !request.ok).map(request => request.route);
      const opConsole = consoleEvents.slice(consoleFrom).map(({ kind, text }) => ({ kind, text }));
      opRecord.console = opConsole.filter(event => !isExpectedConsole(event));
      opRecord.expectedConsole = opConsole.filter(isExpectedConsole);
      for (const expected of op.requests ?? []) {
        const [method, route] = expected.startsWith('POST ') ? ['POST', expected.slice(5)] : ['GET', expected];
        opRecord.checks[`App 發起的同源請求 ${expected} 為 200`] = opRecord.requests.some(request => request.method === method
          && request.route.startsWith(route) && request.status === 200 && request.initiator?.type === 'script');
      }
      try {
        if (op.reveal) await pageCall(cdp, reveal, op.reveal);
        await sleep(300);
        const shot = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })).data, 'base64');
        const file = `${name}-${String(index + 1).padStart(2, '0')}-${op.id}.jpg`;
        fs.writeFileSync(path.join(screensDir, file), shot);
        opRecord.screenshot = `screens/${file}`;
        opRecord.screenshotSha256 = sha256(shot);
      } catch (error) {
        opRecord.screenshotError = error.message;
      }
      // 四欄分開判：畫面／五鍵／console／請求；任一欄不過整步就不過，原因各自可見。
      opRecord.verdict = {
        ui: !opRecord.error && Object.values(opRecord.checks).every(Boolean),
        keys: !opRecord.error && Object.values(opRecord.keyChecks).every(Boolean),
        console: opRecord.console.length === 0,
        requests: opRecord.badRequests.length === 0,
      };
      opRecord.pass = Object.values(opRecord.verdict).every(Boolean);
      const failedAxes = Object.entries(opRecord.verdict).filter(([, ok]) => !ok).map(([axis]) => axis);
      console.log(`${name} ${String(index + 1).padStart(2, '0')} ${op.id}：${opRecord.pass ? 'PASS' : `FAIL（${failedAxes.join('、')}）`}${opRecord.error ? `（${opRecord.error}）` : ''}`);
      if (opRecord.error) break;
    }
    record.finalKeys = await keys().catch(() => null);
    record.externalHosts = [...externalHosts].sort();
    record.allConsole = consoleEvents.map(({ kind, text }) => ({ kind, text }));
  } finally {
    cdp.close();
    record.closedCleanly = await closeChrome(chrome);
    await sleep(500);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      record.profileRemoved = !fs.existsSync(profileDir);
    } catch (error) {
      record.profileRemoved = false;
      record.profileRemoveError = error.message;
    }
  }
  return record;
}

// ── 後端探針彙整（只數事件，不複製原始行）──
function summarizeTrace(traceDir) {
  const counts = {};
  const fetchKinds = {};
  let files = 0;
  for (const name of fs.existsSync(traceDir) ? fs.readdirSync(traceDir) : []) {
    files += 1;
    for (const line of fs.readFileSync(path.join(traceDir, name), 'utf8').split('\n').filter(Boolean)) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      counts[event.ev] = (counts[event.ev] ?? 0) + 1;
      if (event.ev === 'child.fetchStart') fetchKinds[event.kind] = (fetchKinds[event.kind] ?? 0) + 1;
    }
  }
  return {
    files, counts, fetchKinds,
    fakeCli: { spawn: counts['child.fakeCli.spawn'] ?? 0, delta: counts['child.fakeCli.delta'] ?? 0,
      done: counts['child.fakeCli.done'] ?? 0, kill: counts['child.fakeCli.kill'] ?? 0 },
    blocked: { net: counts['child.netBlocked'] ?? 0, fetch: counts['child.fetchBlocked'] ?? 0, ai: counts['child.aiBlocked'] ?? 0 },
  };
}

function persistentSpawns(token) {
  const logFile = path.join(DAILY_RUNTIME, `vercel-${token}.log`);
  if (!fs.existsSync(logFile)) return { logFound: false, enabled: false, takenOver: false, spawns: [], outsideForks: null };
  const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/);
  return {
    logFound: true,
    enabled: lines.some(line => line.includes(PERSISTENT_LOG.enabled)),
    takenOver: lines.some(line => line.includes(PERSISTENT_LOG.takenOver)),
    spawns: lines.map(line => line.match(PERSISTENT_LOG.spawnPattern)).filter(Boolean)
      .map(([, entrypoint, pid, generation]) => ({ entrypoint, pid: Number(pid), generation: Number(generation) })),
    outsideForks: lines.filter(line => line.includes(PERSISTENT_LOG.outsideFork)).length,
  };
}

async function main() {
  const runId = process.argv[2];
  const args = parseArgs(process.argv.slice(3));
  const smoke = args.smoke === true;
  if (!smoke && (args['front-port'] || args['api-port'])) throw new Error('正式 run 固定 3000／3001；改埠只限 --smoke');
  if (smoke) {
    FRONT_PORT = Number(args['front-port']);
    API_PORT = Number(args['api-port']);
    if (![FRONT_PORT, API_PORT].every(port => Number.isInteger(port) && port > 1024 && port < 65535) || FRONT_PORT === 3000) {
      throw new Error('冒煙需指定 3000 以外的 --front-port 與 --api-port');
    }
    ORIGIN = `http://localhost:${FRONT_PORT}`;
  }
  const names = String(args.viewports ?? 'desktop,narrow').split(',').filter(Boolean);
  if (!names.length || names.some(name => !VIEWPORTS[name])) throw new Error(`未知視窗：${names.join(',')}`);
  if (fs.existsSync(STATE_FILE)) throw new Error('日常入口狀態檔已存在，拒絕啟動');
  for (const port of [FRONT_PORT, API_PORT]) {
    if ((await listenerRows(port)).length) throw new Error(`埠 ${port} 已有 listener，不接管`);
  }
  if (!fs.existsSync(CHROME)) throw new Error('找不到 Chrome');
  // 冒煙的證據只留在 runtime（不進 evidence 樹、不算正式）；正式 run 走 claimRun 的不可覆寫規則。
  let evidenceDir;
  let runtimeDir;
  if (smoke) {
    if (!/^app03-smoke-[a-z0-9-]+$/.test(runId ?? '')) throw new Error('冒煙 run-id 需以 app03-smoke- 開頭');
    runtimeDir = path.join(RUNTIME_ROOT, runId);
    if (fs.existsSync(runtimeDir)) throw new Error(`run-id 已使用過：${runId}`);
    evidenceDir = path.join(runtimeDir, 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
  } else {
    ({ evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId }));
  }
  const git = (...gitArgs) => new Promise(resolve => execFile('git', gitArgs, { cwd: ROOT, encoding: 'utf8' },
    (error, stdout) => resolve(error ? null : stdout.trim())));
  const raw = {
    runId, kind: smoke ? 'app-smoke（開發期冒煙，非正式）' : 'app-localhost-3000', formal: !smoke,
    createdAt: nowIso(), origin: ORIGIN, ports: { front: FRONT_PORT, api: API_PORT }, cwd: ROOT.split(path.sep).join('/'),
    git: { head: await git('rev-parse', 'HEAD'), branch: await git('rev-parse', '--abbrev-ref', 'HEAD') },
    versions: toolVersions(),
    tools: Object.fromEntries(TOOL_FILES.map(file => [file, fileSha(path.join(TOOLS, file))])),
    candidateSources: Object.fromEntries(CANDIDATE_FILES.map(file => [file, fileSha(path.join(ROOT, file))])),
    cacheMode: '每個視窗全新 user-data-dir；Chrome HTTP 快取維持預設；後端固定上游與假 AI',
    fixture: { prices: PRICES, usBuyDate: US_BUY_DATE },
    sentinel: null, launcher: {}, monitor: null, viewports: [], backendTrace: null, persistent: null,
    stop: null, stopCheck: null, errors: [],
  };
  const abortSignal = { aborted: false };
  const chromePids = new Set();
  let monitor = null;
  let daily = null;
  let owned = null;
  let stopping = null;
  const stopDaily = reason => {
    stopping ??= (async () => {
      const started = performance.now();
      const result = await execText(process.execPath, [DAILY, 'stop'], { cwd: ROOT });
      return { reason, status: result.status, stdout: result.stdout.split(/\r?\n/).filter(line => !/token|pipe/i.test(line)),
        stderr: result.stderr, ms: Math.round(performance.now() - started) };
    })();
    return stopping;
  };
  try {
    raw.sentinel = await runSentinel({ port: FRONT_PORT, durationMs: 8000, holdMs: 3000 });
    monitor = startForeignMonitor({
      port: FRONT_PORT,
      allowedRoots: () => [process.pid, ...chromePids],
      onForeign: record => {
        abortSignal.aborted = true;
        raw.errors.push(`外部用戶端連進 ${FRONT_PORT}：PID ${record.pid}（${record.name ?? '未知'}），立即停止服務`);
        void stopDaily('外部用戶端');
      },
    });
    daily = await startDaily(runtimeDir, raw);
    owned = ownedState();
    raw.launcher.state = owned.view;
    raw.launcher.listenersAtStart = { [FRONT_PORT]: await listenerRows(FRONT_PORT), [API_PORT]: await listenerRows(API_PORT) };
    const table = await nodeProcesses();
    raw.launcher.identities = [owned.view.supervisorPid, ...owned.view.children.map(child => child.pid)].map(pid => {
      const row = table.get(pid);
      return row ? { pid, parentPid: row.ParentProcessId, creationDate: row.CreationDate, script: scriptOf(row.CommandLine) } : { pid, missing: true };
    });
    // 監督程序底下的整棵程序樹（含 vercel 經 cmd 殼啟動的內部開發伺服器與看門程序），停止後逐一核對。
    raw.launcher.tree = launcherTree(await processTable(), owned.view.supervisorPid);
    for (const name of names) {
      if (abortSignal.aborted) break;
      raw.viewports.push(await runViewport({ name, viewport: VIEWPORTS[name], runtimeDir, evidenceDir, chromePids, abortSignal }));
    }
    raw.launcher.sameStateBeforeAfter = sameJson(ownedState(), owned);
    raw.launcher.listenersAtEnd = { [FRONT_PORT]: await listenerRows(FRONT_PORT), [API_PORT]: await listenerRows(API_PORT) };
  } catch (error) {
    raw.errors.push(error.message);
  } finally {
    raw.monitor = monitor?.stop() ?? null;
    if (owned) raw.persistent = persistentSpawns(owned.token);
    if (daily || fs.existsSync(STATE_FILE)) raw.stop = await stopDaily('驗收結束');
    await sleep(1500);
    raw.stopCheck = {
      stateRemoved: !fs.existsSync(STATE_FILE),
      supervisorExited: daily ? daily.exit.value !== null : null,
      listeners: { [FRONT_PORT]: await listenerRows(FRONT_PORT), [API_PORT]: await listenerRows(API_PORT) },
    };
    if (owned) {
      const table = await nodeProcesses();
      const launcherAlive = [{ pid: owned.view.supervisorPid, creationDate: owned.view.supervisorCreationDate }, ...owned.view.children]
        .filter(item => table.get(item.pid)?.CreationDate === item.creationDate).map(item => item.pid);
      const functionAlive = (raw.persistent?.spawns ?? [])
        .filter(item => /dev-server\.mjs/i.test(table.get(item.pid)?.CommandLine ?? '')).map(item => item.pid);
      raw.stopCheck.aliveOwned = [...launcherAlive, ...functionAlive];
      const everything = await processTable();
      raw.stopCheck.aliveTree = (raw.launcher.tree ?? []).filter(item => everything.get(item.pid)?.CreationDate === item.creationDate)
        .map(({ pid, name }) => ({ pid, name }));
    }
    if (daily) raw.backendTrace = summarizeTrace(daily.traceDir);
    raw.finishedAt = nowIso();
    fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
  }

  // ── 判定（全部由 raw 重算）──
  const problems = [...raw.errors];
  if (raw.monitor?.foreign?.length) problems.push(`監看紀錄：${JSON.stringify(raw.monitor.foreign)}`);
  if (!raw.launcher.state) problems.push('缺日常入口身分');
  const vite = raw.launcher.state?.children?.find(child => /vite/i.test(child.script));
  const vercel = raw.launcher.state?.children?.find(child => /vc\.js/i.test(child.script));
  const frontListeners = raw.launcher.listenersAtStart?.[FRONT_PORT] ?? [];
  if (!frontListeners.length || frontListeners.some(row => row.pid !== vite?.pid)) problems.push('3000 listener 不是本輪 Vite');
  if (!(raw.launcher.listenersAtStart?.[API_PORT] ?? []).some(row => row.pid === vercel?.pid)) problems.push('3001 listener 不含本輪 vercel');
  if (raw.launcher.sameStateBeforeAfter !== true) problems.push('日常入口身分前後不一致');
  if (!raw.persistent?.enabled || !raw.persistent?.takenOver || raw.persistent?.outsideForks) problems.push('長駐候選未確認啟用／接手，或有未經原型的函式子程序');
  if (raw.stop?.status !== 0 || !raw.stopCheck.stateRemoved || raw.stopCheck.supervisorExited === false
    || raw.stopCheck.listeners[FRONT_PORT].length || raw.stopCheck.listeners[API_PORT].length) problems.push('停止後仍有狀態、監督程序或 listener');
  if (raw.stopCheck.aliveOwned?.length) problems.push(`停止後殘留程序：${raw.stopCheck.aliveOwned.join(',')}`);
  const watchdogPid = raw.launcher.state?.watchdog?.pid;
  if (!raw.launcher.tree?.length || !watchdogPid || !raw.launcher.tree.some(item => item.pid === watchdogPid)
    || !raw.launcher.state.children.every(child => raw.launcher.tree.some(item => item.pid === child.pid))) {
    problems.push('就緒程序樹未涵蓋子程序與看門程序');
  }
  if (raw.stopCheck.aliveTree?.length) problems.push(`停止後整棵程序樹仍有殘留：${JSON.stringify(raw.stopCheck.aliveTree)}`);
  const trace = raw.backendTrace;
  if (!trace || trace.blocked.net || trace.blocked.fetch || trace.blocked.ai) problems.push('後端探針有非預期 outbound 或 AI 被擋');
  if (trace && Object.keys(trace.fetchKinds).some(kind => !FIXTURE_KINDS.includes(kind))) problems.push('後端出現非固定上游的 outbound 類別');
  for (const viewport of raw.viewports) {
    if (!viewport.closedCleanly) problems.push(`${viewport.name} Chrome 未正常關閉`);
    if (!viewport.profileRemoved) problems.push(`${viewport.name} 隔離資料目錄未刪除`);
  }
  if (raw.viewports.length !== names.length) problems.push('視窗數不足');
  const leaks = scanSecrets(evidenceDir).filter(hit => !/\.jpg$/i.test(hit.file));
  if (leaks.length) problems.push(`證據疑似含秘密：${leaks.map(hit => `${hit.file}:${hit.key}`).join(',')}`);
  const failedOps = raw.viewports.flatMap(viewport => viewport.ops.filter(op => !op.pass).map(op => `${viewport.name}/${op.id}`));
  const incomplete = raw.viewports.filter(viewport => viewport.ops.length !== EXPECTED_OPS).map(viewport => viewport.name);
  const summary = {
    runId, formal: raw.formal, origin: raw.origin, problems, failedOps, incompleteViewports: incomplete,
    viewports: raw.viewports.map(viewport => ({ name: viewport.name, ops: viewport.ops.map(op => `${op.id}:${op.pass ? 'PASS' : 'FAIL'}`),
      externalHosts: viewport.externalHosts ?? null, unexpectedConsole: viewport.ops.reduce((sum, op) => sum + op.console.length, 0),
      expectedConsole: viewport.ops.reduce((sum, op) => sum + op.expectedConsole.length, 0),
      designedAborts: viewport.ops.flatMap(op => (op.designedAborts ?? []).map(item => `${op.id}：${item.aborted}`)),
      failedAxes: viewport.ops.filter(op => !op.pass).map(op => ({ op: op.id,
        axes: Object.entries(op.verdict ?? {}).filter(([, ok]) => !ok).map(([axis]) => axis) })),
      requestKinds: viewport.ops.flatMap(op => op.requests).reduce((counts, request) => {
        counts[request.kind] = (counts[request.kind] ?? 0) + 1;
        return counts;
      }, {}),
      failedRequests: viewport.ops.flatMap(op => op.requests.filter(request => request.ok === false)
        .map(request => ({ op: op.id, route: request.route, kind: request.kind, status: request.status, failed: request.failed,
          initiator: request.initiator?.frames?.slice(0, 8) ?? null }))),
      finalKeys: viewport.finalKeys })),
    sentinel: { events: raw.sentinel?.events?.length ?? null, neutralized: raw.sentinel?.visibleTabsNeutralized ?? null },
    monitor: { checks: raw.monitor?.checks ?? null, foreign: raw.monitor?.foreign?.length ?? null },
    fakeCli: trace?.fakeCli ?? null, fetchKinds: trace?.fetchKinds ?? null, blocked: trace?.blocked ?? null,
    persistentSpawns: raw.persistent?.spawns?.length ?? null,
    tree: { recorded: raw.launcher.tree?.length ?? null, aliveAfterStop: raw.stopCheck.aliveTree ?? null },
  };
  const toolSha = fileSha(fileURLToPath(import.meta.url)).slice(0, 12);
  fs.writeFileSync(path.join(evidenceDir, `app-summary-${toolSha}.json`), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(summary, null, 2));
  if (problems.length) return 2;
  return failedOps.length || incomplete.length ? 1 : 0;
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});
