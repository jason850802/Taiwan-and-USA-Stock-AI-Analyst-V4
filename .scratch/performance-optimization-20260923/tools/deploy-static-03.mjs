#!/usr/bin/env node
// 03 票：正式 Vercel 部署路徑的靜態核對（不部署、不打正式網域）。
//
// 用法（repo 根目錄）：
//   node .scratch/performance-optimization-20260923/tools/deploy-static-03.mjs <新 run-id> --workdir C:/pfv7 [--base 6a7b029]
//
// 回答「03 的改動會不會改變正式部署」中能在本機證明的部分：
// 1. 部署設定檔（package／lock、.vercelignore、vercel.json／vercel.ts、index.html、tsconfig）自 03 起點零差異。
// 2. 正式函式路由集合不變（api/ 下非 _lib、非測試的進入點）。
// 3. 本機專用的長駐預載與探針只在 .scratch，被 .vercelignore 排除；產品檔沒有任何引用。
// 4. 在隔離 checkout 分別以 03 起點與目前的 vite.config.ts 建置正式前端（不設本機 envDir），逐檔比對產物雜湊。
// 正式平台是否把用戶端斷線傳成 res 'close'、取消後上游是否停止，本工具無法證明，必須另以部署實測。
// exit 0＝上述四項全部成立；1＝有項目不成立；2＝run 無效。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimRun, fileSha, forwardSlashes, toolVersions } from './service-kit.mjs';
import { ROOT, parseArgs, scanSecrets } from './verify-b1-breakdown.mjs';

const DEPLOY_FILES = ['package.json', 'package-lock.json', '.vercelignore', 'vercel.json', 'vercel.ts', 'index.html', 'tsconfig.json'];
const LOCAL_ONLY_PATTERN = 'persistent-functions|trace-preload|PERF0[13]_|NODE_OPTIONS';
const NON_PRODUCT = [':!.scratch', ':!.planning', ':!docs', ':!.claude', ':!.agents', ':!.codex', ':!prompts'];

const sha = data => createHash('sha256').update(data).digest('hex');
const git = (cwd, args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: forwardSlashes(cwd) },
});
const lines = text => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const functionEntries = (ref) => lines(git(ROOT, ['ls-tree', '-r', '--name-only', ref, 'api']))
  .filter(file => /\.ts$/.test(file) && !file.startsWith('api/_lib/') && !/\.test\.ts$/.test(file)).sort();

function listTree(dir) {
  const out = {};
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[forwardSlashes(path.relative(dir, full))] = sha(fs.readFileSync(full));
    }
  };
  walk(dir);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function build(workdir, config, outDir) {
  const env = { ...process.env };
  delete env.LOCAL_FRONTEND_ENV_DIR;
  delete env.LOCAL_API_ORIGIN;
  execFileSync(process.execPath, [path.join(workdir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', config,
    '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], { cwd: workdir, env, stdio: 'pipe', encoding: 'utf8' });
  return listTree(outDir);
}

function main() {
  const runId = process.argv[2];
  const args = parseArgs(process.argv.slice(3));
  const base = args.base ?? '6a7b029';
  const workdir = path.resolve(args.workdir ?? '');
  if (!args.workdir || workdir.toLowerCase() === path.resolve(ROOT).toLowerCase()) throw new Error('--workdir 必須是隔離 checkout');
  // 隔離 checkout 的前端建置輸入必須與主工作樹逐位元組相同，才代表目前候選。
  const buildInputs = ['vite.config.ts', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json'];
  const mismatch = buildInputs.filter(file => fileSha(path.join(workdir, file)) !== fileSha(path.join(ROOT, file)));
  if (mismatch.length) throw new Error(`隔離 checkout 與主工作樹不同：${mismatch.join('、')}`);
  const oldConfig = path.join(workdir, `vite.config.base-${base}.tmp.ts`);
  if (fs.existsSync(oldConfig)) throw new Error('暫存設定檔已存在，拒絕覆寫');
  const { evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId });

  const head = git(ROOT, ['rev-parse', 'HEAD']).trim();
  const raw = {
    runId, kind: 'deploy-static', createdAt: new Date().toISOString(), base: git(ROOT, ['rev-parse', base]).trim(), head,
    workdir: forwardSlashes(workdir), versions: toolVersions(), toolSha256: fileSha(fileURLToPath(import.meta.url)),
    deployFiles: null, functionRoutes: null, vercelignore: null, localOnlyRefs: null, frontendBuild: null,
    notProvable: [
      '正式平台（Vercel Node runtime）是否在用戶端斷線時對 handler 的 res 發出 close／req aborted',
      '正式平台取消後上游（Yahoo／FinMind／AI）是否實際停止',
      '正式平台的串流 flush 與取消時序',
    ],
    errors: [],
  };
  try {
    // 1. 部署設定檔
    const changed = lines(git(ROOT, ['diff', '--name-only', base, head, '--', ...DEPLOY_FILES]));
    raw.deployFiles = { files: DEPLOY_FILES, changedSinceBase: changed,
      present: DEPLOY_FILES.filter(file => fs.existsSync(path.join(ROOT, file))) };
    // 2. 正式函式路由集合
    const before = functionEntries(base);
    const after = functionEntries(head);
    raw.functionRoutes = { base: before, head: after, same: JSON.stringify(before) === JSON.stringify(after) };
    // 3. 本機專用工具的隔離
    const ignore = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8');
    raw.vercelignore = { excludesScratch: lines(ignore).includes('.scratch'),
      preloadPaths: ['persistent-functions.cjs', 'trace-preload.cjs'].map(name => `.scratch/performance-optimization-20260923/tools/${name}`) };
    let refs = '';
    try {
      refs = git(ROOT, ['grep', '-n', '-I', '-E', LOCAL_ONLY_PATTERN, head, '--', '.', ...NON_PRODUCT]);
    } catch (error) {
      if (error.status !== 1) throw error;   // git grep 找不到時 exit 1
    }
    raw.localOnlyRefs = { pattern: LOCAL_ONLY_PATTERN, productHits: lines(refs) };
    // 4. 正式前端建置產物：03 起點的 vite.config.ts 與目前版本各建一次，同一份原始碼。
    fs.writeFileSync(oldConfig, git(ROOT, ['show', `${base}:vite.config.ts`]));
    try {
      const oldTree = build(workdir, path.basename(oldConfig), path.join(runtimeDir, 'dist-base'));
      const newTree = build(workdir, 'vite.config.ts', path.join(runtimeDir, 'dist-head'));
      const names = [...new Set([...Object.keys(oldTree), ...Object.keys(newTree)])].sort();
      raw.frontendBuild = {
        baseConfigSha256: sha(git(ROOT, ['show', `${base}:vite.config.ts`])), headConfigSha256: fileSha(path.join(ROOT, 'vite.config.ts')),
        files: names.length, differing: names.filter(name => oldTree[name] !== newTree[name]),
        aggregateBase: sha(JSON.stringify(oldTree)), aggregateHead: sha(JSON.stringify(newTree)), head: newTree,
      };
    } finally {
      fs.rmSync(oldConfig, { force: true });
      raw.tempConfigRemoved = !fs.existsSync(oldConfig);
    }
  } catch (error) {
    raw.errors.push(error.message);
  }
  raw.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);

  const checks = {
    '部署設定檔自 03 起點零差異': raw.deployFiles?.changedSinceBase.length === 0,
    '正式函式路由集合不變': raw.functionRoutes?.same === true,
    '.vercelignore 排除 .scratch（本機預載不上傳）': raw.vercelignore?.excludesScratch === true,
    '產品檔沒有引用本機專用工具': raw.localOnlyRefs?.productHits.length === 0,
    '03 前後兩版設定建置的正式前端逐檔相同': Boolean(raw.frontendBuild && raw.frontendBuild.files > 0
      && raw.frontendBuild.differing.length === 0),
  };
  const leaks = scanSecrets(evidenceDir);
  const problems = [...raw.errors, ...(raw.tempConfigRemoved === false ? ['暫存設定檔未刪除'] : []),
    ...(leaks.length ? [`證據疑似含秘密：${leaks.map(hit => `${hit.file}:${hit.key}`).join(',')}`] : [])];
  const summary = { runId, base: raw.base, head, checks, problems, notProvable: raw.notProvable };
  fs.writeFileSync(path.join(evidenceDir, `deploy-summary-${raw.toolSha256.slice(0, 12)}.json`), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(summary, null, 2));
  if (problems.length) return 2;
  return Object.values(checks).every(Boolean) ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
