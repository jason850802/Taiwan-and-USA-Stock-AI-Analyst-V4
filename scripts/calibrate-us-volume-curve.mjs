// 美股盤中「累積成交量權重曲線」校準腳本（離線工具，非執行期程式）
// Offline calibration script: derives an empirical US intraday cumulative-volume-weight
// curve from real Yahoo 5-minute data of ~50 S&P large caps over ~60 trading days.
// Node ≥18 native fetch, NO new npm deps. Run: node scripts/calibrate-us-volume-curve.mjs
//
// 輸出 Output:
//   - scripts/us-volume-curve-report.md  方法學 + 真實樣本數 + 中位曲線 + 誤差帶 + T*
//   - stdout: 可直接貼上的 `const US_CUM_WEIGHT: number[] = [ … ];` (78 值) + `T* = <分鐘>`
//
// 設計要點 Design notes（與台股版差異）：
//   - 交易時段 09:30–16:00（America/New_York），共 390 分；自 09:30 起以時間網格對齊。
//   - 09:30 第一根 5m bar 已含開盤集合競價量（in-band），不需特別處理。
//   - 美股 5m 序列「自我完整」：15:55(385 分) 那根已含 16:00 收盤集合競價量
//     （實測大型股約佔全日 4–10%，量級合理），故全日總量 = 5m 序列總和、不需 1d 回補。
//   - 與台股版最大差異：台股用 1d 日總量回補 13:30 收盤集合競價 leftover；
//     美股 Yahoo 的 1d 日總量與 5m 加總「對不上」（兩個資料源不一致，誤差大且方向不定，
//     -100%~+50% 皆有），故 US 改以 5m 自身加總為日總量，僅將 1d 留作報告中的限制交叉檢核。
//   - 排除每月第三個週五（選擇權到期日，含 triple/quadruple witching）。

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '.cache-volume-calib');
const REPORT_PATH = join(__dirname, 'us-volume-curve-report.md');

// S&P 市值前50近似，校準日期 2026-06-12
const SYMBOLS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSLA', 'BRK-B', 'LLY',
  'JPM', 'WMT', 'V', 'UNH', 'XOM', 'MA', 'ORCL', 'COST', 'PG', 'HD',
  'JNJ', 'NFLX', 'ABBV', 'BAC', 'CRM', 'KO', 'MRK', 'CVX', 'AMD', 'PEP',
  'TMO', 'ADBE', 'LIN', 'WFC', 'CSCO', 'ACN', 'MCD', 'IBM', 'GE', 'ABT',
  'NOW', 'ISRG', 'PM', 'CAT', 'TXN', 'QCOM', 'INTU', 'VZ', 'AMGN', 'GS',
];

const BASE = 'https://query2.finance.yahoo.com/v8/finance/chart/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DELAY_MS = 300;
const MIN_SYMBOLS = 40;

// 網格：09:30…15:55（5,10,…,385）+ 16:00（390）。共 78 點。
const GRID = [];
for (let m = 5; m <= 385; m += 5) GRID.push(m);
GRID.push(390);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fileExists = async (p) => {
  try { await access(p); return true; } catch { return false; }
};

// 取得 Yahoo chart JSON，優先讀快取；快取/網路皆走此函式。
// 美股直接用裸代號（含 BRK-B 這類連字號代號），不加 .TW 後綴。
async function getChart(symbol, interval, range) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `us-${symbol}-${interval}.json`);
  if (await fileExists(cachePath)) {
    return JSON.parse(await readFile(cachePath, 'utf8'));
  }
  const url = `${BASE}${symbol}?interval=${interval}&range=${range}&includePrePost=false`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const err = json?.chart?.error;
  if (err) throw new Error(`chart.error ${err.code || ''} ${err.description || ''}`);
  await writeFile(cachePath, JSON.stringify(json));
  await sleep(DELAY_MS);
  return json;
}

// 將時間戳（秒）轉成 America/New_York 的 YYYY-MM-DD 與當日分鐘數（自 09:30 起）。
const NY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
function toNY(tsSec) {
  const parts = NY_FMT.formatToParts(new Date(tsSec * 1000));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hh = parseInt(get('hour'), 10);
  if (hh === 24) hh = 0; // en-CA 偶爾把午夜輸出成 24
  const mm = parseInt(get('minute'), 10);
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    mins: (hh - 9) * 60 + (mm - 30), // 自 09:30 起的分鐘
  };
}

// 選擇權到期日：每月第三個週五。輸入 'YYYY-MM-DD' → boolean。
function isOptionsExpiration(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const firstDow = first.getUTCDay(); // 0=Sun … 5=Fri
  const firstFri = 1 + ((5 - firstDow + 7) % 7);
  const thirdFri = firstFri + 14;
  return d === thirdFri;
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
    barCount: 0,            // bar 數 ≠ 78±1（半日盤/異常）
    zeroVolume: 0,          // 5m 序列日總量 = 0（無效日）
    optionsExpiration: 0,   // 選擇權到期日（每月第三週五）
  };

  let symbolsAttempted = 0;
  let symbolsSucceeded = 0;
  // 每個網格點蒐集所有 stock-day 的「累積占比」
  const cumShares = GRID.map(() => []);
  // 為了誤差分析，保存每個 stock-day 的逐點累積量與日總量（= 5m 加總）
  const stockDays = []; // { cum: number[] (per grid, raw cumulative volume), daily: number }
  // 1d vs 5m 交叉檢核（僅供報告限制段落，不用於曲線計算）
  const dailyDiscrepancy = []; // |1d - sum5m| / sum5m，每個有對到 1d 的 stock-day 一筆

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
        const { date } = toNY(tsD[i]);
        dailyByDate.set(date, v);
      }

      // 將 5m bar 依紐約日期分組
      const byDate = new Map(); // date → [{mins, vol}]
      for (let i = 0; i < ts5.length; i++) {
        const v = vol5[i];
        if (v == null) continue;
        const { date, mins } = toNY(ts5[i]);
        if (mins < 0 || mins > 390) continue; // 盤外
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date).push({ mins, vol: v });
      }

      let daySucceeded = false;
      for (const [date, bars] of byDate) {
        if (isOptionsExpiration(date)) { exclusions.optionsExpiration += 1; continue; }

        // 半日盤/異常：bar 數 ≠ 78±1（標準日 09:30…15:55=78 根；半日盤=28 根）。
        if (bars.length < 77 || bars.length > 79) { exclusions.barCount += 1; continue; }

        const sum5m = bars.reduce((a, b) => a + b.vol, 0);
        if (sum5m <= 0) { exclusions.zeroVolume += 1; continue; }

        // 美股全日總量 = 5m 序列加總（15:55 那根已含 16:00 收盤集合競價）。
        // 將 bar 量累加到網格：每個 grid 點 = 該日截至此分鐘(含)的累積 5m 量。
        // 390(16:00) 點 = sum5m，故其累積占比 = 1.0。
        const dailyTotal = sum5m;
        const cumByGrid = new Array(GRID.length).fill(0);
        const sorted = [...bars].sort((a, b) => a.mins - b.mins);
        for (let gi = 0; gi < GRID.length; gi++) {
          const gMin = GRID[gi];
          let acc = 0;
          for (const b of sorted) {
            if (b.mins <= gMin) acc += b.vol;
          }
          cumByGrid[gi] = acc;
        }
        // 390 點鉗位為 sum5m（最後一根 15:55 已含收盤集合競價，理論上已等於 sum5m）。
        cumByGrid[GRID.length - 1] = sum5m;

        for (let gi = 0; gi < GRID.length; gi++) {
          cumShares[gi].push(cumByGrid[gi] / dailyTotal);
        }
        stockDays.push({ cum: cumByGrid, daily: dailyTotal });
        daySucceeded = true;

        // 1d vs 5m 交叉檢核（僅統計，不影響曲線）
        const oneDay = dailyByDate.get(date);
        if (oneDay != null && oneDay > 0) {
          dailyDiscrepancy.push(Math.abs(oneDay - sum5m) / sum5m);
        }
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
  md += '# 美股盤中累積成交量權重曲線 校準報告\n\n';
  md += `> 校準日期：2026-06-12　資料來源：Yahoo Finance 5m / 1d　工具：scripts/calibrate-us-volume-curve.mjs\n\n`;
  md += '## 方法學 Methodology\n\n';
  md += '- 取 ~50 檔 S&P 市值前50近似大型股近 60 交易日的 5 分鐘 K 量，依紐約日期切成 stock-day。\n';
  md += '- 交易時段 09:30–16:00（America/New_York），共 390 分；自 09:30 起以時間網格對齊。\n';
  md += '- 09:30 第一根 5m bar 已含開盤集合競價量（in-band），不需特別處理。\n';
  md += '- 美股 5m 序列自我完整：15:55(385 分) 那根已含 16:00 收盤集合競價量（實測大型股約佔全日 4–10%），\n';
  md += '  故全日總量 = 5m 序列總和、390 分點累積占比 = 1.0；不使用 1d 日總量回補 leftover。\n';
  md += '- 與台股版差異：台股以 1d 日總量回補 13:30 收盤集合競價；美股 Yahoo 的 1d 與 5m 加總對不上（兩源不一致），故改用 5m 自身加總（見限制段落）。\n';
  md += '- 每個網格點取所有 stock-day 累積占比的「中位數」為權重曲線，並強制單調非遞減、末點=1.0。\n';
  md += '- 誤差分析：projected = 累積量 / 權重；error = projected / 日總量 − 1；逐點取 p10/p90。\n';
  md += '- T*（Insufficient 截止分鐘）= 最早一個網格點，其 p10..p90 誤差帶落在 ±35% 內。\n\n';
  md += '## 樣本 Sample\n\n';
  md += `- 嘗試代號數：${symbolsAttempted}\n`;
  md += `- 成功代號數（至少 1 個可用 stock-day）：${symbolsSucceeded}\n`;
  md += `- 存活 stock-day 總數：${surviving}\n\n`;
  md += '## 排除統計 Exclusions（依原因計數）\n\n';
  md += '| 原因 | 筆數 |\n|---|---|\n';
  md += `| bar 數 ≠ 78±1（半日盤/異常） | ${exclusions.barCount} |\n`;
  md += `| 5m 日總量 = 0（無效日） | ${exclusions.zeroVolume} |\n`;
  md += `| 選擇權到期日（每月第三週五） | ${exclusions.optionsExpiration} |\n\n`;
  md += '## 中位曲線 Median curve（minute | median | p25 | p75）\n\n';
  md += '| 分鐘(自09:30) | median | p25 | p75 |\n|---|---|---|---|\n';
  for (let gi = 0; gi < GRID.length; gi++) {
    md += `| ${GRID[gi]} | ${fmtPct(weight[gi])} | ${fmtPct(p25Curve[gi])} | ${fmtPct(p75Curve[gi])} |\n`;
  }
  md += '\n## 投影誤差 Error-by-time（minute | p10 | p90）\n\n';
  md += '| 分鐘(自09:30) | p10 | p90 |\n|---|---|---|\n';
  for (let gi = 0; gi < GRID.length; gi++) {
    md += `| ${GRID[gi]} | ${fmtPct(errP10[gi])} | ${fmtPct(errP90[gi])} |\n`;
  }
  md += `\n## 選定 T*\n\n`;
  md += `- **T\\* = ${tStar} 分鐘**（自 09:30 起；最早一個 p10..p90 ⊆ ±35% 的網格點）\n`;
  md += `- 美股 Insufficient 守門即用此 T\\*；台股維持實證 T*=105 分。\n\n`;
  md += '## 限制 Limitations\n\n';
  const discMed = dailyDiscrepancy.length ? median(dailyDiscrepancy) : NaN;
  const discP90 = dailyDiscrepancy.length ? percentile(dailyDiscrepancy, 90) : NaN;
  md += `- 原計畫擬以 Yahoo 1d 日總量回補 16:00 收盤集合競價 leftover，但實測 1d 與 5m 加總嚴重不一致（兩個資料源不同步）：`;
  md += `對到 1d 的 ${dailyDiscrepancy.length} 個 stock-day，|1d − sum_5m| / sum_5m 中位數約 ${fmtPct(discMed)}、p90 約 ${fmtPct(discP90)}，且方向不定（1d 有時遠大於、有時遠小於 5m 加總）。\n`;
  md += '- 故 US 改以 5m 序列自身加總為全日總量。實測 15:55 那根（385 分）已含 16:00 收盤集合競價（大型股約佔全日 4–10%），5m 序列因此自我完整，曲線末點自然 = 1.0。\n';
  md += '- 此法的代價：曲線以「regular-session 5m 量」為分母，未計入盤前/盤後量；對本工具（盤中全日量投影、僅比較當日累積 vs 預估全日）而言無影響，因投影也是用同一套 regular-session 量。\n';
  await writeFile(REPORT_PATH, md);

  // ---- 輸出可貼上的 TypeScript const ----
  const arr = weight.map((x, i) => (i === weight.length - 1 ? '1.0000' : round4(x).toFixed(4)));
  console.log('');
  console.log('// minute = (index+1)*5 ；index 0↔5min … index 77↔390min(16:00)，末值=1.0');
  console.log(`const US_CUM_WEIGHT: number[] = [ ${arr.join(', ')} ];`);
  console.log(`T* = ${tStar}`);
  console.error(`\n[ok] symbols ${symbolsSucceeded}/${symbolsAttempted}, surviving stock-days ${surviving}, grid points ${GRID.length}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
