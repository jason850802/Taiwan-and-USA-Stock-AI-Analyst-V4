// utils/vercelIgnoreGuard.test.ts — api/ 測試檔不得被部署成 Vercel 函式的鎖
//
// 守的是什麼：Vercel 零設定會把 api/ 底下「非 _ 或 . 開頭」的 .ts 全部部署成函式，測試檔也不例外。
// 2026-07-31 的正式部署因此多出一支 api/gemini-stream.test（775.68KB）：它 import vitest、
// 沒有 handler，冷啟動一載入就丟「Vitest failed to access its internal state」，被呼叫只會回
// 500 FUNCTION_INVOCATION_FAILED——guard 與限流根本沒機會跑，每次呼叫卻照樣算一次函式呼叫。
// 解法是 .vercelignore 排除 api/**/*.test.ts：Git 部署在建置前就把它們刪掉（建置 log 的
// 「Removed N ignored files defined in .vercelignore」）、CLI 部署不上傳、vercel dev 也看不到。
// 沒有這把鎖時，刪掉那一行或換一種測試檔命名，都不會有任何紅燈。
//
// 兩個斷言，各擋一種漂移：
//  1. .vercelignore 保有 api/**/*.test.ts，且沒有 ! 開頭的反向規則——gitignore 語法裡 ! 會把
//     前面排除的檔案撈回來。真的需要反向規則時，把本斷言收窄成「不得撈回 api/ 底下的檔案」。
//  2. api/ 底下的測試檔一律 .test.ts 結尾——規則只蓋得到這種命名；改用 .spec.ts、.test.tsx、
//     .test.mjs 之類（vitest 照收），就會漏網被部署成函式。
//
// 邊界：本鎖只證明規則在、命名蓋得到。Vercel 真的沒部署，要看 vercel build 產出的
// .vercel/output/functions 或 vercel inspect 的函式清單，本機單元測試看不到。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const TEST_FILE_RULE = 'api/**/*.test.ts';
// vitest 預設 include（**/*.{test,spec}.?(c|m)[jt]s?(x)）收得到的測試檔命名
const TEST_LIKE = /\.(test|spec)\.[cm]?[jt]sx?$/;

function vercelIgnoreRules(): string[] {
  return readFileSync(path.join(ROOT, '.vercelignore'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

function filesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...filesUnder(relative));
    else files.push(relative);
  }
  return files;
}

describe('.vercelignore：api/ 測試檔不部署成函式', () => {
  const testFiles = filesUnder('api').filter((file) => TEST_LIKE.test(file));

  it('找得到 api/ 的測試檔（避免清單為空時空轉的假綠燈）', () => {
    expect(testFiles).toContain('api/gemini-stream.test.ts');
  });

  it(`保有 ${TEST_FILE_RULE} 規則，且沒有反向規則把它撈回來`, () => {
    const rules = vercelIgnoreRules();
    expect(rules).toContain(TEST_FILE_RULE);
    expect(rules.filter((rule) => rule.startsWith('!'))).toEqual([]);
  });

  it('api/ 底下的測試檔一律 .test.ts 結尾，其他命名會漏網被部署', () => {
    expect(testFiles.filter((file) => !file.endsWith('.test.ts'))).toEqual([]);
  });
});
