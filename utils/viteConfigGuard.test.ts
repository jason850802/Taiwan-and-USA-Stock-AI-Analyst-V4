// utils/viteConfigGuard.test.ts — 金鑰紅線的 build 設定防漂移鎖（gate-audit G3）
//
// 守的是什麼：後端秘密（GEMINI_API_KEY／FINMIND_TOKEN 等非 VITE_ 前綴的 .env 變數）
// 進不了前端 bundle，唯一的機制是 Vite 的 `envPrefix` 只曝 `VITE_`。gate-audit 實測
// （docs/gate-audit-findings.md 的 E3 表第 6 條）證實：即使程式整體引用 `import.meta.env`，
// 非 VITE_ 變數也不會被內聯——但只要有人在 vite.config.ts 加一行 `envPrefix: ''`
// 或 `define: { 'process.env': ... }`，全部 .env 變數立刻具備進 bundle 的資格。
// 在本測試存在之前，那樣改**不會有任何測試紅燈**。
//
// 建鎖時實測到的修正（G3 原文的例子要打折扣）：`envPrefix: ''` 其實 Vite 自己就擋——
// resolveEnvPrefix() 會 throw「could lead unexpected exposure of sensitive information」，
// 連 vitest 都起不來。真正沒人擋的是**放寬**前綴（`['VITE_', 'GEMINI_']`——想把模型名
// 這類設定丟給前端時最容易順手加）與 `define`，這兩條才是本鎖的主要守備範圍。
//
// 三層斷言，各擋一種漂移：
//  1. 匯出設定：擋直接改 vite.config.ts 的字面值。
//  2. resolveConfig 後的設定：擋由 plugin 的 config hook 注入的 envPrefix／define
//     （plugin 改得動最終設定，光讀匯出物件看不到）。
//  3. 行為層：拿 Vite 自己的 loadEnv 對一份 fixture .env 跑一次，證明「非 VITE_ 前綴的值
//     真的不會被曝出來」——鎖的是機制本身，不只是設定的拼字。
//
// **這條紅了不是壞事，是本鎖的交付物**：它代表有人動了決定「什麼東西可以進前端」的設定。
// 若哪天真的需要 define（例如注入版號常數），不要直接放寬斷言——改成明列白名單鍵名，
// 並在此處寫下「該值不是從 .env／process.env 來的」的理由，讓下一個人看得到判斷依據。
//
// 邊界：本鎖只看 build 設定。金鑰真的漏進產物時的最後一道是 `npm run gate` 的金鑰掃描
// （讀 .env 實際值對 dist/ 做字面比對）；兩者是不同層，不能互相取代。
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, resolveConfig } from 'vite';
import rawConfig from '../vite.config';

const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'vite.config.ts');

describe('vite envPrefix 防漂移鎖', () => {
  it('匯出設定顯式指定 envPrefix 為 VITE_', () => {
    // 刻意要求「顯式」而非「等於預設值」：靠預設值等於沒有防護，
    // 而且顯式寫出來，改動才會出現在 diff 裡被人看見。
    expect(rawConfig.envPrefix).toBe('VITE_');
  });

  it('匯出設定未使用 define', () => {
    // define 是繞過 envPrefix 的旁路：`define: { 'process.env': process.env }`
    // 會把整個環境（含後端金鑰）搬進 bundle，而 envPrefix 管不到它。
    expect(rawConfig.define).toBeUndefined();
  });

  for (const command of ['build', 'serve'] as const) {
    it(`resolveConfig（${command}）後仍是 VITE_ 且無 define——plugin 沒有偷改`, async () => {
      const resolved = await resolveConfig({ root: ROOT, configFile: CONFIG_FILE }, command);
      expect(resolved.envPrefix).toBe('VITE_');
      expect(resolved.define).toBeUndefined();
    });
  }
});

describe('vite envPrefix 行為驗證', () => {
  // 用 fixture .env 而非專案真正的 .env：真檔在 CI／新 clone 上不存在（斷言會變成空轉的
  // 假綠燈），而且斷言一旦紅了，vitest 會把整個 env 物件印進終端——真金鑰不能這樣曝光。
  it('loadEnv 只曝 VITE_ 前綴的值，後端秘密名不會出現', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vite-env-prefix-'));
    try {
      const fixtureSecret = 'fixture-backend-secret-not-a-real-key';
      writeFileSync(
        path.join(dir, '.env'),
        [
          `GEMINI_API_KEY=${fixtureSecret}`,
          `FINMIND_TOKEN=${fixtureSecret}`,
          'VITE_PUBLIC_FIXTURE=exposed-on-purpose',
        ].join('\n'),
        'utf8',
      );

      const env = loadEnv('production', dir, rawConfig.envPrefix);

      // 先證明 fixture 真的被讀到，否則下面的「不存在」是空轉的假綠燈
      expect(env.VITE_PUBLIC_FIXTURE).toBe('exposed-on-purpose');
      expect(env).not.toHaveProperty('GEMINI_API_KEY');
      expect(env).not.toHaveProperty('FINMIND_TOKEN');
      // 不只看鍵名：值本身也不能從任何鍵漏出去
      expect(Object.values(env)).not.toContain(fixtureSecret);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
