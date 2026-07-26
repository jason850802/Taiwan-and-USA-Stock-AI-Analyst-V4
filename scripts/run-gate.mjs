#!/usr/bin/env node
// scripts/run-gate.mjs — 一鍵機械驗收 gate（`npm run gate`）
//
// 為什麼存在：CORE_RULES 的機械 gate 是五道人工指令，其中「金鑰掃描」在 PowerShell 5.1
// 上沒有 grep 可用（LESSONS 2026-07-06 起的環境雷區），實務上最常被跳過。這支腳本把五道
// 收成一個指令，文字掃描全部在 node 內做，**零外部依賴（只用 node 內建模組）**。
//
// 順序：tsc → vitest → build → 金鑰掃描 → package.json/package-lock.json diff
// fail-fast：前一段紅了就停（tsc 紅掉時 build 的結果沒有意義）。任一段失敗 → exit 1，
// 結尾摘要會標明是哪一段紅的。
//
// 涵蓋範圍的邊界（別誤以為綠燈＝驗證完成）：runtime 類的驗證這支腳本管不到——
// console 零紅字、UI 數字要量不能只用肉眼看、快取類要換乾淨代號，仍須照 CORE_RULES 人工做。
//
// 金鑰掃描的三條規則（設計理由見 docs/gate-audit-findings.md）：
//   (a) Google 金鑰形狀：`dist/` 用字面前綴掃（產物沒有任何理由出現這四個字），
//       git 追蹤中的原始碼則要求「前綴＋30 字以上金鑰字元」——因為 api/_lib/http.ts
//       的 log 消毒 regex 本身就含這個前綴，用裸字面掃原始碼會開箱即紅。
//   (b) 讀 `.env*` 所有值（長度 >8）對 `dist/` 做字面比對：**任何形狀的秘密**都抓，
//       不限 Google 金鑰。無 `.env*` 時整條略過。
//   (c) 讀 `.env*` 中「名字看起來是秘密」的值（KEY／TOKEN／SECRET／PASSWORD 等）
//       對 git 追蹤中的原始碼做字面比對。這條補的是紅線「不進前端 bundle **或 git**」
//       的後半句——(a)(b) 只看得到 build 產物，金鑰被 tree-shaking 移除但仍躺在原始碼裡
//       的情境（gate-audit E2 已實證）只有這條擋得住。(c) 限定「秘密名」是為了避開
//       GEMINI_MODEL_FAST 這類設定值必然出現在原始碼裡造成的誤報。

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// 本檔是 git 追蹤中的非 .md 檔，會被自己的原始碼掃描讀進來：金鑰前綴若以字面寫死，
// gate 會掃到自己。拆兩段在 runtime 組回來，檔案內就不存在該字面。
const KEY_PREFIX = 'AI' + 'za';
const KEY_SHAPED = new RegExp(KEY_PREFIX + '[0-9A-Za-z_-]{30,}');
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_PAT)$/i;
const MAX_REPORTED = 20; // 單條規則最多列這麼多筆，避免刷爆終端

let failedSection = null;

function banner(text) {
  console.log(`\n=== ${text} ===`);
}

/** 跑一條指令，stdio 直接接到終端（讓 tsc/vitest/vite 的輸出原樣呈現）。 */
function sh(command, args) {
  const r = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: true });
  return r.status === 0;
}

/** 跑 git 並取回 stdout（buffer 模式，才能安全處理 -z 的 NUL 分隔）。 */
function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, shell: true });
  return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0) };
}

/** 讀成文字；讀不到或看起來是二進位（含 NUL byte）就回 null。 */
function readText(absPath) {
  try {
    const buf = readFileSync(absPath);
    if (buf.includes(0)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** 秘密值不進終端：只留前 4 碼與長度，足夠讓人回去 .env 對號。 */
function mask(value) {
  return `${value.slice(0, 4)}…(len=${value.length})`;
}

function rel(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

// ── 掃描對象的兩份清單 ────────────────────────────────────────────────────────

function distFiles() {
  const dist = path.join(ROOT, 'dist');
  if (!existsSync(dist) || !statSync(dist).isDirectory()) return [];
  return walk(dist);
}

/** git 追蹤中的檔案，排除 *.md（規則文件本身就含金鑰前綴做說明，掃了必誤報）。 */
function trackedSourceFiles() {
  const { status, stdout } = git(['ls-files', '-z']);
  if (status !== 0) return null;
  return stdout
    .toString('utf8')
    .split('\0')
    .filter(p => p && !p.toLowerCase().endsWith('.md'))
    .map(p => path.join(ROOT, p))
    .filter(p => existsSync(p));
}

/** 解析 `.env*`（跳過 .env.example 這類範本：裡面是佔位符，比對只會製造誤報）。 */
function envSecrets() {
  const names = readdirSync(ROOT)
    .filter(n => n.startsWith('.env'))
    .filter(n => !/\.(example|sample|template)$/i.test(n));
  const found = [];
  for (const name of names) {
    const text = readText(path.join(ROOT, name));
    if (text === null) continue;
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const [, key, rawValue] = m;
      const stripQuotes = s => s.replace(/^(['"])([\s\S]*)\1$/, '$2');
      const raw = stripQuotes(rawValue.trim());
      // 有些 .env 寫法會在值後面接 # 註解。兩種切法都收：漏掉任何一種都是安全上的假綠燈。
      const noComment = stripQuotes(rawValue.replace(/\s+#.*$/, '').trim());
      const values = [...new Set([raw, noComment])].filter(v => v.length > 8);
      for (const value of values) found.push({ file: name, key, value });
    }
  }
  return found;
}

// ── 各段 ─────────────────────────────────────────────────────────────────────

function stepTsc() {
  banner('[1/5] tsc --noEmit');
  return sh('npx', ['tsc', '--noEmit']);
}

function stepVitest() {
  banner('[2/5] vitest run');
  return sh('npm', ['run', 'test']);
}

function stepBuild() {
  banner('[3/5] vite build');
  return sh('npm', ['run', 'build']);
}

function stepSecretScan() {
  banner('[4/5] 金鑰掃描');
  const hits = [];
  const dist = distFiles();
  const tracked = trackedSourceFiles();

  if (dist.length === 0) {
    console.log('  ✗ dist/ 不存在或為空——build 段沒有產出，掃描無意義');
    return false;
  }
  if (tracked === null) {
    console.log('  ✗ git ls-files 失敗（不在 git repo 內？）——原始碼掃描無法執行');
    return false;
  }

  // (a1) dist/ 用裸前綴：產物裡沒有任何正當理由出現這四個字
  for (const f of dist) {
    const text = readText(f);
    if (text === null) continue;
    const idx = text.indexOf(KEY_PREFIX);
    if (idx !== -1) hits.push(`(a) ${rel(f)}:${lineOf(text, idx)} 出現 Google 金鑰前綴`);
  }

  // (a2) 追蹤中的原始碼用「有形狀」的比對：避開 log 消毒 regex 這類正當字面
  for (const f of tracked) {
    const text = readText(f);
    if (text === null) continue;
    const m = text.match(KEY_SHAPED);
    if (m) hits.push(`(a) ${rel(f)}:${lineOf(text, m.index)} 原始碼含 Google 金鑰形狀字串`);
  }

  const secrets = envSecrets();
  if (secrets.length === 0) {
    console.log('  · 無 .env* 可讀（或無長度 >8 的值）→ (b)(c) 略過');
  } else {
    // (b) 所有 .env 值 → dist/
    for (const f of dist) {
      const text = readText(f);
      if (text === null) continue;
      for (const s of secrets) {
        if (text.includes(s.value)) {
          hits.push(`(b) ${s.file} 的 ${s.key} ${mask(s.value)} 出現在建置產物 ${rel(f)}`);
        }
      }
    }
    // (c) 只有「秘密名」的值 → git 追蹤中的原始碼
    const secretNamed = secrets.filter(s => SECRET_NAME.test(s.key));
    for (const f of tracked) {
      const text = readText(f);
      if (text === null) continue;
      for (const s of secretNamed) {
        if (text.includes(s.value)) {
          hits.push(`(c) ${s.file} 的 ${s.key} ${mask(s.value)} 出現在 git 追蹤檔 ${rel(f)}`);
        }
      }
    }
  }

  if (hits.length === 0) {
    console.log(`  ✓ 乾淨（掃 dist/ ${dist.length} 檔、追蹤原始碼 ${tracked.length} 檔、`
      + `.env 值 ${secrets.length} 筆）`);
    return true;
  }
  console.log(`  ✗ 掃到 ${hits.length} 筆：`);
  for (const h of hits.slice(0, MAX_REPORTED)) console.log(`      ${h}`);
  if (hits.length > MAX_REPORTED) console.log(`      …其餘 ${hits.length - MAX_REPORTED} 筆略`);
  return false;
}

function stepPackageDiff() {
  banner('[5/5] package.json / package-lock.json diff');
  const paths = ['--', 'package.json', 'package-lock.json'];
  const vsIndex = git(['diff', '--quiet', ...paths]);
  if (vsIndex.status !== 0) {
    console.log('  ✗ 相對於 index 有未提交的變動——本次改動動到了依賴宣告或 lockfile');
    console.log('      查看：git diff -- package.json package-lock.json');
    return false;
  }
  // 已 staged 的變動 `git diff --quiet <paths>` 看不到（文件版 gate 的盲區，見 findings）。
  // 不讓它決定紅綠（避免「刻意改 scripts 尚未 commit」被誤判），但一定要講出來。
  const vsHead = git(['diff', '--quiet', 'HEAD', ...paths]);
  if (vsHead.status !== 0) {
    console.log('  ✓ 工作樹與 index 一致');
    console.log('  · 注意：相對於 HEAD 仍有差異（已 staged 或已 commit 的改動）。');
    console.log('      若非刻意，查看：git diff HEAD -- package.json package-lock.json');
  } else {
    console.log('  ✓ 與 HEAD 完全一致');
  }
  return true;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

const STEPS = [
  ['tsc', stepTsc],
  ['vitest', stepVitest],
  ['build', stepBuild],
  ['金鑰掃描', stepSecretScan],
  ['package diff', stepPackageDiff],
];

for (const [name, fn] of STEPS) {
  if (!fn()) {
    failedSection = name;
    break;
  }
}

if (failedSection) {
  console.log(`\n✗ GATE 紅燈：${failedSection} 段未通過（後續段落未執行）。`);
  process.exit(1);
}

console.log('\n✓ GATE 全綠（機械部分）。');
console.log('  runtime 類驗證腳本管不到，仍須人工：console 零紅字、UI 數字要量、快取換乾淨代號。');
