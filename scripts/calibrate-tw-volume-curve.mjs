// 台股盤中「累積成交量權重曲線」校準腳本（離線工具，非執行期程式）
// Offline calibration script: derives an empirical TW intraday cumulative-volume-weight
// curve from real Yahoo 5-minute data of ~50 large caps over ~60 trading days.
// Node ≥18 native fetch, NO new npm deps. Run: node scripts/calibrate-tw-volume-curve.mjs
//
// 輸出 Output:
//   - scripts/tw-volume-curve-report.md  方法學 + 真實樣本數 + 中位曲線 + 誤差帶 + T*
//   - stdout: 可直接貼上的 `const TW_CUM_WEIGHT: number[] = [ … ];` (55 值) + `T* = <分鐘>`
//
// 設計要點 Design notes:
//   - 5m 序列「漏掉」13:30 收盤集合競價量 → 用 1d 日總量回補 leftover 給 270 分(13:30)點。
//   - bar 以「bar-start」標記，09:00 那根可能量=0；一律用時間網格對齊，不假設開盤量落在哪根。

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '.cache-volume-calib');
const REPORT_PATH = join(__dirname, 'tw-volume-curve-report.md');

// 0050 成分股近似，校準日期 2026-06-12
const SYMBOLS = [
  '2330', '2317', '2454', '2308', '2382', '2881', '2891', '2882', '2412', '2303',
  '2886', '2884', '3711', '2885', '2357', '3034', '2892', '2880', '2002', '1216',
  '2207', '2301', '3008', '2345', '3231', '2383', '2890', '5880', '2883', '2887',
  '1303', '1301', '1326', '6505', '2912', '1101', '2603', '2609', '2615', '3017',
  '3037', '2379', '6669', '3661', '3653', '2360', '4938', '2327', '5871', '2395',
];

const BASE = 'https://query2.finance.yahoo.com/v8/finance/chart/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DELAY_MS = 300;
const MIN_SYMBOLS = 40;

// 網格：09:05…13:25（5,10,…,265）+ 13:30（270）。共 54 點。
const GRID = [];
for (let m = 5; m <= 265; m += 5) GRID.push(m);
GRID.push(270);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fileExists = async (p) => {
  try { await access(p); return true; } catch { return false; }
};

// 取得 Yahoo chart JSON，優先讀快取；快取/網路皆走此函式。
async function getChart(symbol, interval, range) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `${symbol}-${interval}.json`);
  if (await fileExists(cachePath)) {
    return JSON.parse(await readFile(cachePath, 'utf8'));
  }
  const url = `${BASE}${symbol}.TW?interval=${interval}&range=${range}&includePrePost=false`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const err = json?.chart?.error;
  if (err) throw new Error(`chart.error ${err.code || ''} ${err.description || ''}`);
  await writeFile(cachePath, JSON.stringify(json));
  await sleep(DELAY_MS);
  return json;
}

// 將時間戳（秒）轉成 Asia/Taipei 的 YYYY-MM-DD 與當日分鐘數（自 09:00 起）。
const TPE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
function toTaipei(tsSec) {
  const parts = TPE_FMT.formatToParts(new Date(tsSec * 1000));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hh = parseInt(get('hour'), 10);
  if (hh === 24) hh = 0; // en-CA 偶爾把午夜輸出成 24
  const mm = parseInt(get('minute'), 10);
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    mins: (hh - 9) * 60 + mm, // 自 09:00 起的分鐘
  };
}

// 期指結算日：每月第三個週三。輸入 'YYYY-MM-DD' → boolean。
function isFutsSettlement(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const firstDow = first.getUTCDay(); // 0=Sun … 3=Wed
  const firstWed = 1 + ((3 - firstDow + 7) % 7);
  const thirdWed = firstWed + 14;
  return d === thirdWed;
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const percentile = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  const idx = Math.min(n - 1, Math.max(0, Math.round((p / 100) * (n - 1))));
  return s[idx];
};
const round4 = (x) => Math.round(x * 1e4) / 1e4;

async function main() {
  const exclusions = {
    barCount: 0,            // bar 數 ≠ 54±1
    leftoverNegative: 0,    // sum_5m > daily_total
    lowCoverage: 0,         // sum_5m < 50% daily_total
    noDaily: 0,             // 1d 序列缺該日
    futsSettlement: 0,      // 期指結算日
  };

  let symbolsAttempted = 0;
  let symbolsSucceeded = 0;
  // 每個網格點蒐集所有 stock-day 的「累積占比」
  const cumShares = GRID.map(() => []);
  // 為了誤差分析，保存每個 stock-day 的逐點累積量與日總量
  const stockDays = []; // { cum: number[] (per grid, raw cumulative volume), daily: number }

  for (const symbol of SYMBOLS) {
    symbolsAttempted += 1;
    let fiveMin, daily;
    try {
      fiveMin = await getChart(symbol, '5m', '60d');
      daily = await getChart(symbol, '1d', '3mo');
    } catch (e) {
      console.error(`skip ${symbol}: ${e.message}`);
      continue;
    }

    try {
      const r5 = fiveMin.chart.result[0];
      const ts5 = r5.timestamp || [];
      const vol5 = r5.indicators.quote[0].volume || [];

      const rD = daily.chart.result[0];
      const tsD = rD.timestamp || [];
      const volD = rD.indicators.quote[0].volume || [];

      // 1d 日總量查表：date → volume
      const dailyByDate = new Map();
      for (let i = 0; i < tsD.length; i++) {
        const v = volD[i];
        if (v == null) continue;
        const { date } = toTaipei(tsD[i]);
        dailyByDate.set(date, v);
      }

      // 將 5m bar 依台北日期分組
      const byDate = new Map(); // date → [{mins, vol}]
      for (let i = 0; i < ts5.length; i++) {
        const v = vol5[i];
        if (v == null) continue;
        const { date, mins } = toTaipei(ts5[i]);
        if (mins < 0 || mins > 270) continue; // 盤外
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date).push({ mins, vol: v });
      }

      let daySucceeded = false;
      for (const [date, bars] of byDate) {
        if (isFutsSettlement(date)) { exclusions.futsSettlement += 1; continue; }

        // 半日盤/異常：bar 數 ≠ 54±1（09:05…13:25=53 根 + 13:30 可能不在 5m → 視 53/54）
        if (bars.length < 53 || bars.length > 55) { exclusions.barCount += 1; continue; }

        const dailyTotal = dailyByDate.get(date);
        if (dailyTotal == null || dailyTotal <= 0) { exclusions.noDaily += 1; continue; }

        const sum5m = bars.reduce((a, b) => a + b.vol, 0);
        const leftover = dailyTotal - sum5m;
        if (leftover < 0) { exclusions.leftoverNegative += 1; continue; }
        if (sum5m < 0.5 * dailyTotal) { exclusions.lowCoverage += 1; continue; }

        // 將 bar 量累加到網格：每個 grid 點 = 該日截至此分鐘(含)的累積 5m 量。
        // 13:30(270) 點再加上 leftover → 等於 dailyTotal。
        const cumByGrid = new Array(GRID.length).fill(0);
        // 先建立各 bar 的累積（依 mins 排序）
        const sorted = [...bars].sort((a, b) => a.mins - b.mins);
        for (let gi = 0; gi < GRID.length; gi++) {
          const gMin = GRID[gi];
          let acc = 0;
          for (const b of sorted) {
            if (b.mins <= gMin) acc += b.vol;
          }
          cumByGrid[gi] = acc;
        }
        // 270 點補上 leftover（收盤集合競價）
        cumByGrid[GRID.length - 1] = sum5m + leftover; // = dailyTotal

        for (let gi = 0; gi < GRID.length; gi++) {
          cumShares[gi].push(cumByGrid[gi] / dailyTotal);
        }
        stockDays.push({ cum: cumByGrid, daily: dailyTotal });
        daySucceeded = true;
      }

      if (daySucceeded) symbolsSucceeded += 1;
    } catch (e) {
      console.error(`skip ${symbol}: parse ${e.message}`);
      continue;
    }
  }

  if (symbolsSucceeded < MIN_SYMBOLS) {
    console.error(`BLOCKER: only ${symbolsSucceeded}/${symbolsAttempted} symbols yielded usable stock-days (need ≥${MIN_SYMBOLS}). Refusing to emit a low-sample curve.`);
    process.exit(1);
  }

  // 中位曲線 + p25/p75
  const medianCurve = cumShares.map((a) => median(a));
  const p25Curve = cumShares.map((a) => percentile(a, 25));
  const p75Curve = cumShares.map((a) => percentile(a, 75));

  // 強制單調非遞減 + 末點=1.0（投影用權重必須良好定義）
  const weight = medianCurve.map((x) => x);
  for (let i = 1; i < weight.length; i++) {
    if (weight[i] < weight[i - 1]) weight[i] = weight[i - 1];
  }
  weight[weight.length - 1] = 1.0;

  // 誤差分析：對每個 stock-day、每個網格點 t，projected = cum(t)/weight(t)，error = projected/daily − 1
  const errByGrid = GRID.map(() => []);
  for (const sd of stockDays) {
    for (let gi = 0; gi < GRID.length; gi++) {
      const w = weight[gi];
      if (w <= 0) continue;
      const projected = sd.cum[gi] / w;
      errByGrid[gi].push(projected / sd.daily - 1);
    }
  }
  const errP10 = errByGrid.map((a) => percentile(a, 10));
  const errP90 = errByGrid.map((a) => percentile(a, 90));

  // T*：最早一個網格點，其 p10..p90 帶寬落在 ±35% 內
  let tStar = GRID[GRID.length - 1];
  for (let gi = 0; gi < GRID.length; gi++) {
    if (errP10[gi] >= -0.35 && errP90[gi] <= 0.35) { tStar = GRID[gi]; break; }
  }

  // ---- 輸出報告 ----
  const surviving = stockDays.length;
  const fmtPct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(2) + '%' : 'N/A');
  let md = '';
  md += '# 台股盤中累積成交量權重曲線 校準報告\n\n';
  md += `> 校準日期：2026-06-12　資料來源：Yahoo Finance 5m / 1d　工具：scripts/calibrate-tw-volume-curve.mjs\n\n`;
  md += '## 方法學 Methodology\n\n';
  md += '- 取 ~50 檔大型權值股（0050 成分股近似）近 60 交易日的 5 分鐘 K 量，依台北日期切成 stock-day。\n';
  md += '- 5m 序列遺漏 13:30 收盤集合競價量；以 1d 日總量回補 leftover 至 270 分(13:30)點，使該點累積占比 = 1.0。\n';
  md += '- bar 以 bar-start 標記，09:00 那根可能量=0；一律以時間網格（自 09:00 起的分鐘）對齊。\n';
  md += '- 每個網格點取所有 stock-day 累積占比的「中位數」為權重曲線，並強制單調非遞減、末點=1.0。\n';
  md += '- 誤差分析：projected = 累積量 / 權重；error = projected / 日總量 − 1；逐點取 p10/p90。\n';
  md += '- T*（Insufficient 截止分鐘）= 最早一個網格點，其 p10..p90 誤差帶落在 ±35% 內。\n\n';
  md += '## 樣本 Sample\n\n';
  md += `- 嘗試代號數：${symbolsAttempted}\n`;
  md += `- 成功代號數（至少 1 個可用 stock-day）：${symbolsSucceeded}\n`;
  md += `- 存活 stock-day 總數：${surviving}\n\n`;
  md += '## 排除統計 Exclusions（依原因計數）\n\n';
  md += '| 原因 | 筆數 |\n|---|---|\n';
  md += `| bar 數 ≠ 54±1（半日盤/異常） | ${exclusions.barCount} |\n`;
  md += `| sum_5m > 日總量（leftover 為負） | ${exclusions.leftoverNegative} |\n`;
  md += `| sum_5m < 50% 日總量（覆蓋不足） | ${exclusions.lowCoverage} |\n`;
  md += `| 1d 序列缺該日 | ${exclusions.noDaily} |\n`;
  md += `| 期指結算日（每月第三週三） | ${exclusions.futsSettlement} |\n\n`;
  md += '## 中位曲線 Median curve（minute | median | p25 | p75）\n\n';
  md += '| 分鐘(自09:00) | median | p25 | p75 |\n|---|---|---|---|\n';
  for (let gi = 0; gi < GRID.length; gi++) {
    md += `| ${GRID[gi]} | ${fmtPct(weight[gi])} | ${fmtPct(p25Curve[gi])} | ${fmtPct(p75Curve[gi])} |\n`;
  }
  md += '\n## 投影誤差 Error-by-time（minute | p10 | p90）\n\n';
  md += '| 分鐘(自09:00) | p10 | p90 |\n|---|---|---|\n';
  for (let gi = 0; gi < GRID.length; gi++) {
    md += `| ${GRID[gi]} | ${fmtPct(errP10[gi])} | ${fmtPct(errP90[gi])} |\n`;
  }
  md += `\n## 選定 T*\n\n`;
  md += `- **T\\* = ${tStar} 分鐘**（自 09:00 起；最早一個 p10..p90 ⊆ ±35% 的網格點）\n`;
  md += `- 台股 Insufficient 守門即用此 T\\*；美股維持 5 分鐘。\n`;
  await writeFile(REPORT_PATH, md);

  // ---- 輸出可貼上的 TypeScript const ----
  const arr = weight.map((x, i) => (i === weight.length - 1 ? '1.0000' : round4(x).toFixed(4)));
  console.log('');
  console.log('// minute = (index+1)*5 ；index 0↔5min … index 54↔270min(13:30)，末值=1.0');
  console.log(`const TW_CUM_WEIGHT: number[] = [ ${arr.join(', ')} ];`);
  console.log(`T* = ${tStar}`);
  console.error(`\n[ok] symbols ${symbolsSucceeded}/${symbolsAttempted}, surviving stock-days ${surviving}, grid points ${GRID.length}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
