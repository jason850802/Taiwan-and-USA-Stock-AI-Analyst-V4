// utils/vercelConfigGuard.test.ts — Vercel 請求取消的部署設定鎖（票 03 平台取消診斷）
//
// 守的是什麼：使用者關頁／取消時，後端要停止呼叫 AI 與行情上游。程式端由 api/_lib/clientAbort.ts
// 聽未完成的 res 'close' 與 req 'aborted'；但在 Vercel 上，這些事件只有在函式設定開了
// `supportsCancellation: true` 時才會發生——這是 opt-in，預設不通知函式用戶端已斷線。
// 2026-09-30 用同一份 bundle、只差這個旗標的 Preview 對照：開＝斷線後約 0.85 秒停（20 段只送 1 段）；
// 關＝照樣跑滿到 done（見 03 票面「平台取消診斷」一節）。沒有這把鎖時，刪掉 vercel.json 不會有任何紅燈。
//
// 兩個斷言，各擋一種漂移：
//  1. 每支 API 函式恰好被一個 functions 樣式命中，且該樣式開了 supportsCancellation。
//  2. 命中的樣式不設 maxDuration：vercel.json 與程式碼 export 的設定逐欄合併（vercel.json 優先），
//     在這裡寫 maxDuration 會蓋掉 api/gemini-stream.ts 宣告的 200 秒。
//
// 邊界：本鎖只證明設定在。平台上真的會停，要對 Preview 跑斷線探針並對帳平台 logs，本機測不到。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const VERCEL_JSON = path.join(ROOT, 'vercel.json');

type FunctionConfig = { supportsCancellation?: boolean; maxDuration?: number };

/** 會被 Vercel 部署成函式的 api/ 原始檔：排除 _ 或 . 開頭的目錄／檔案與測試檔。 */
function apiFunctionFiles(dir = 'api'): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...apiFunctionFiles(relative));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(relative);
  }
  return files;
}

function readFunctionsConfig(): Record<string, FunctionConfig> {
  expect(existsSync(VERCEL_JSON), '缺 vercel.json：Vercel 不會把用戶端斷線通知函式').toBe(true);
  return JSON.parse(readFileSync(VERCEL_JSON, 'utf8')).functions ?? {};
}

describe('Vercel 請求取消設定鎖', () => {
  const files = apiFunctionFiles();

  it('找得到 API 函式檔（避免清單為空時空轉的假綠燈）', () => {
    expect(files).toEqual(expect.arrayContaining(['api/gemini-stream.ts', 'api/gemini.ts', 'api/finmind.ts',
      'api/yahoo/chart.ts', 'api/yahoo/search.ts']));
  });

  it('每支 API 函式恰好被一個 functions 樣式命中，且開啟 supportsCancellation', () => {
    const functions = readFunctionsConfig();
    for (const file of files) {
      const matched = Object.entries(functions).filter(([pattern]) => path.posix.matchesGlob(file, pattern));
      expect(matched.map(([pattern]) => pattern), `${file} 應恰好被一個樣式命中`).toHaveLength(1);
      expect(matched[0][1].supportsCancellation, `${file} 未開 supportsCancellation`).toBe(true);
    }
  });

  it('命中的樣式不設 maxDuration，讓程式碼宣告的時限生效', () => {
    const functions = readFunctionsConfig();
    for (const file of files) {
      for (const [pattern, config] of Object.entries(functions)) {
        if (path.posix.matchesGlob(file, pattern)) {
          expect(config.maxDuration, `${pattern} 會蓋掉 ${file} 的 maxDuration`).toBeUndefined();
        }
      }
    }
  });
});
