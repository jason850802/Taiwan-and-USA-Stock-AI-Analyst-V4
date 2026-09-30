// utils/tsconfigScopeGuard.test.ts — tsconfig 型檢範圍內的 JS 檔不得寫 globalThis 屬性的鎖
//
// 守的是什麼：Vercel 建置 api/ 函式時，@vercel/node 用本專案 tsconfig 做型別檢查，而且把
// tsconfig 涵蓋的檔案全部拉進同一個程式（它呼叫 register 時帶 files: true）。tsconfig 開著
// allowJs、沒設 include，預設的 **/* 連根目錄下的 .js／.mjs 一起收。
// TypeScript 對 JS 檔有條特殊規則：頂層的 `globalThis.X = …` 或 `Object.defineProperty(globalThis, …)`
// 會被當成「宣告全域 X」，同檔巢狀位置的 `globalThis.Y = …` 也跟著變成全域宣告。本機 tsc 永遠
// 先載 lib.dom.d.ts，lib 的宣告是型別正本，看不出問題；@vercel/node 的 LanguageService 卻把讀過
// 的 lib 檔塞到根檔清單尾端，從第二次建程式起 JS 檔排在 lib 前面，腳本裡的假實作就成了正本。
// 2026-09-30 的正式建置因此多出 5 個 error TS：scripts/benchmark-market-data.mjs 為了量測把
// fetch 換成假函式，api/_lib/yahoo.ts、api/finmind.ts 的 fetch(url, init) 就被當成「最多 1 個
// 參數、回傳 { ok, json }」。@vercel/node 只印不擋、runtime 也正常，gate 與正式站都不會紅——
// 沒有這把鎖，下一支 stub 全域的量測腳本照樣會默默污染部署時的型別檢查。
//
// 修法是 tsconfig 的 exclude 加 scripts（開發工具不屬於 App，本來就不該進型檢）。本鎖驗的是
// 「範圍內沒有觸發條件」而不是 exclude 的寫法，改用 include 白名單之類的做法也照樣成立。
// 偵測刻意比觸發條件寬：不分頂層或巢狀一律擋，規則比較好懂。範圍內的 JS 檔真的要改 global，
// 用 Reflect.set(globalThis, …)，它不會被當成宣告。
//
// 邊界：本鎖只擋已知的觸發條件。Vercel 型檢實際乾不乾淨，要看 vercel build 的輸出或
// vercel inspect --logs 有沒有 error TS，本機單元測試看不到。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const JS_FILE_PATTERN = /\.[cm]?jsx?$/;

/** tsconfig 的型檢範圍（@vercel/node 以 files: true 讀到的就是這份清單），轉成相對路徑。 */
function typecheckScope(): string[] {
  const configPath = path.join(ROOT, 'tsconfig.json');
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, ROOT, undefined, configPath);
  return parsed.fileNames.map((file) => path.relative(ROOT, file).split(path.sep).join('/'));
}

/** 回傳 JS 原始碼裡「寫 globalThis 屬性」的行號（1 起算）：屬性賦值與 Object.defineProperty 兩種。 */
function globalThisWriteLines(fileName: string, text: string): number[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const lines: number[] = [];
  const isGlobalThisMember = (node: ts.Expression): boolean => {
    let target = node;
    while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      target = target.expression;
    }
    return target !== node && ts.isIdentifier(target) && target.text === 'globalThis';
  };
  const visit = (node: ts.Node): void => {
    const isAssignment = ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && isGlobalThisMember(node.left);
    const isDefineProperty = ts.isCallExpression(node)
      && node.expression.getText(source) === 'Object.defineProperty'
      && node.arguments.length > 0
      && ts.isIdentifier(node.arguments[0])
      && node.arguments[0].text === 'globalThis';
    if (isAssignment || isDefineProperty) {
      lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

describe('tsconfig 型檢範圍：JS 檔不得寫 globalThis 屬性', () => {
  const scope = typecheckScope();

  it('型檢範圍涵蓋 api/ 原始碼（避免設定解析失敗、清單為空時空轉的假綠燈）', () => {
    expect(scope).toContain('api/_lib/yahoo.ts');
    expect(scope).toContain('api/finmind.ts');
  });

  it('偵測器認得兩種寫法、放過 Reflect.set 與唯讀存取（避免偵測器壞掉時的假綠燈）', () => {
    const sample = [
      'globalThis.fetch = async () => ({ ok: true });',
      "Object.defineProperty(globalThis, 'sessionStorage', { value: {} });",
      "Reflect.set(globalThis, 'Date', Date);",
      'const originalFetch = globalThis.fetch;',
      'try { globalThis.fetch = originalFetch; } finally {}',
    ].join('\n');
    expect(globalThisWriteLines('sample.mjs', sample)).toEqual([1, 2, 5]);
  });

  it('範圍內的 JS 檔都沒有寫 globalThis 屬性', () => {
    const offenders = scope
      .filter((file) => JS_FILE_PATTERN.test(file))
      .flatMap((file) => globalThisWriteLines(file, readFileSync(path.join(ROOT, file), 'utf8'))
        .map((line) => `${file}:${line}`));
    expect(offenders).toEqual([]);
  });
});
