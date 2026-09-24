#!/usr/bin/env node
// 02 票：長駐原型的重載驗證——改碼、語法錯誤、改 .env、刪路由、串流進行中改碼之後，候選會不會換成新碼、
// 會不會回舊碼、會不會切斷進行中的串流。
//
// 用法（repo 根目錄執行）：
//   node .scratch/performance-optimization-20260923/tools/c-reload.mjs --run-id <新代號> --port-base <連續 12 個未占用埠> --workdir C:/pfv7
//   node .scratch/performance-optimization-20260923/tools/c-reload.mjs --verify <run-id>   （只重算判定）
//
// 只在隔離 checkout 執行：workdir 不得是主工作區；產品樹（排除文件／代理目錄）逐檔等於 30dfdb2、沒有未提交的
// 產品變更，也沒有未追蹤的函式檔或會影響函式的根目錄設定檔；原本不得有 .env／.env.build／.vercel（本工具會建立
// 測試用的最小 .env 與 .vercel 連結複本，結束時刪除並記錄刪了什麼）。
// 在 workdir 同時起 B1 與候選（固定上游，不打真上游、不啟動真 AI）：B1 每支請求重新 fork，一定載入當下檔案，
// 是「有沒有拿到新碼」的參照；候選每一步都必須與 B1 回應一致，並符合該步的預期條件。
// 結束時逐檔還原被改的產品檔並以位元組比對原內容，再核一次產品樹；證據寫 evidence/02/<run-id>/。
// exit 0＝每一步都與 B1 一致、預期條件成立且候選有偵測到變更；1＝有差異；2＝run 無效。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_COMMIT, FUNCTION_ROOT_FILES, PERSISTENT, PERSISTENT_LOG, PRELOAD, claimRun, copyTrace, createFixtureControl,
  fileSha, forwardSlashes, isProductPath, persistentReport, probeEnv, sendRequest, sha256, sleep, startVercelDev,
  stopService, toolHashes, toolVersions, waitForTraceEvent,
} from './service-kit.mjs';
import {
  EVIDENCE_BASE, ROOT, VERIFIER_SHA, identityProblems, parseArgs, persistentProblems, scanSecrets, writeOnceOrCompare,
} from './verify-b1-breakdown.mjs';

const TICKET = '02';
const LIB_FILE = 'api/_lib/yahoo.ts';
const CHART_FILE = 'api/yahoo/chart.ts';
const SEARCH_FILE = 'api/yahoo/search.ts';
const ORIGINAL_MESSAGE = '請求參數不正確，請確認股票代號與時間區間設定。';
const RELOAD_MARKER = '（重載測試）';
const STREAM_EDIT_MARKER = '\n// perf02 串流進行中改碼測試\n';
const TEST_SECRET_LINE = 'PROXY_SHARED_SECRET=perf02-reload-test-secret';
// 測試用 .env 只放非秘密值；不複製主工作區 .env。LLM_PROVIDER 讓 AI 路由走 CLI 橋接（被探針換成假 CLI）。
const TEST_ENV = 'ALLOWED_ORIGIN=http://localhost:3000\nLLM_PROVIDER=claude-cli\n';
// 工具會建立、所以開始前不得存在的檔案（.env.build 也會被 vercel dev 讀取）。
const PREEXISTING_FORBIDDEN = ['.env', '.env.build', '.vercel'];
const INVALIDATE_WAIT_MS = 8000;
const EDIT_SETTLE_MS = 1500;
// 串流中改碼：舊原型改碼 5 秒後送 shutdown，dev-server 最多再等 30 秒就結束程序；
// 50 秒的假串流在改碼後仍有約 45 秒，足以判別「等在途請求結束」與「約 35 秒後切斷」。
const LONG_STREAM_AI = { deltas: 25, intervalMs: 2000 };
const LONG_STREAM_TIMEOUT_MS = 90_000;
const CHART_OK = '/api/yahoo/chart?symbol=2330.TW&interval=1d&range=5d';
const CHART_BAD = '/api/yahoo/chart?symbol=2330.TW&interval=1d&range=1y';
const SEARCH_OK = '/api/yahoo/search?q=2330';
const STREAM_ROUTE = '/api/gemini-stream';
const STREAM_BODY = JSON.stringify({ prompt: '重載測試提示詞', systemInstruction: '重載測試系統指令', mode: 'fast' });

const hasMarker = probe => Boolean(probe.bodyText?.includes(RELOAD_MARKER));
const bothStatus = (probe, status) => probe.b1.status === status && probe.c.status === status;

// 串流有沒有完整跑完：最後一行是 done，且片段數等於假 CLI 設定的段數。
export function streamCompleted(response, deltas) {
  const kinds = (response.lines ?? []).map(line => {
    try {
      return JSON.parse(line.text).t;
    } catch {
      return null;
    }
  });
  return response.status === 200 && kinds.filter(kind => kind === 'delta').length === deltas && kinds.at(-1) === 'done';
}

// 步驟表：apply 改檔、routes 改檔後兩邊各打一次、checks 由探測結果（與執行當下的觀察）算出必須成立的條件。
// 判定器依步驟名查這張表，從 raw 重算條件；改檔步驟與判定放在同一處。
export const STEPS = [
  { id: 'baseline', routes: [CHART_OK, CHART_BAD, SEARCH_OK], checks: () => ({}) },
  {
    id: 'edit-lib-message', routes: [CHART_BAD],
    apply: w => w.write(LIB_FILE, w.text(LIB_FILE).replace(ORIGINAL_MESSAGE, ORIGINAL_MESSAGE + RELOAD_MARKER)),
    checks: ([p]) => ({ '兩邊都拿到新訊息': hasMarker(p.b1) && hasMarker(p.c) }),
  },
  {
    id: 'syntax-error', routes: [CHART_OK],
    apply: w => w.write(CHART_FILE, `${w.text(CHART_FILE)}\nexport const perf02Broken = ;\n`),
    checks: ([p]) => ({ '兩邊都不再回舊碼的成功結果': p.b1.status !== 200 && p.c.status !== 200 }),
  },
  { id: 'restore-syntax', routes: [CHART_OK], apply: w => w.restore(CHART_FILE), checks: ([p]) => ({ '還原後兩邊恢復': bothStatus(p, 200) }) },
  { id: 'env-add-secret', routes: [CHART_OK], apply: w => w.writeEnv(`${TEST_ENV}${TEST_SECRET_LINE}\n`), checks: ([p]) => ({ '兩邊都因缺密鑰拒絕': bothStatus(p, 403) }) },
  { id: 'env-restore', routes: [CHART_OK], apply: w => w.writeEnv(TEST_ENV), checks: ([p]) => ({ '兩邊恢復放行': bothStatus(p, 200) }) },
  { id: 'delete-route', routes: [SEARCH_OK], apply: w => w.remove(SEARCH_FILE), checks: ([p]) => ({ '兩邊都找不到路由': bothStatus(p, 404) }) },
  { id: 'restore-route', routes: [SEARCH_OK], apply: w => w.restore(SEARCH_FILE), checks: ([p]) => ({ '路由還原後兩邊恢復': bothStatus(p, 200) }) },
  { id: 'restore-lib', routes: [CHART_BAD], apply: w => w.restore(LIB_FILE), checks: ([p]) => ({ '訊息還原後兩邊都回原文': !hasMarker(p.b1) && !hasMarker(p.c) }) },
  {
    // 串流進行中改碼：流程另寫在 main（兩邊同時開 50 秒的串流，候選收到第 2 段後改 api/ 檔案）。
    id: 'edit-during-stream', routes: [STREAM_ROUTE], stream: true,
    checks: ([p], observed) => ({
      '改碼發生在串流進行中（候選已收到第 2 段）': Boolean(observed.editedAfterSecondDelta),
      'B1 串流完整跑完': streamCompleted(p.b1, LONG_STREAM_AI.deltas),
      '候選串流沒有被停用流程切斷': streamCompleted(p.c, LONG_STREAM_AI.deltas),
    }),
  },
];
const STEP_BY_ID = new Map(STEPS.map(step => [step.id, step]));

// 隔離 checkout 的 git：safe.directory 只經環境變數給這一個目錄，不改任何 git 設定檔。
const git = (cwd, args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: forwardSlashes(cwd) },
});

// 隔離 checkout 的產品樹：追蹤中的產品檔（排除文件／代理目錄）逐檔與 30dfdb2 比（含未提交的修改），
// 未追蹤檔只看會被 vercel dev 當成函式或設定讀進去的（api/ 底下與根目錄設定檔）。
function productState(workdir) {
  const lines = args => git(workdir, args).split('\n').map(line => line.trim()).filter(Boolean);
  return {
    differsFromBaseline: lines(['diff', '--name-only', BASELINE_COMMIT]).filter(isProductPath),
    untrackedFunctionFiles: lines(['ls-files', '--others', '--exclude-standard'])
      .filter(p => p.startsWith('api/') || FUNCTION_ROOT_FILES.includes(p)),
  };
}
const productClean = state => !state.differsFromBaseline.length && !state.untrackedFunctionFiles.length;

const countInvalidations = logFile => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(line => line.includes(PERSISTENT_LOG.invalidation)).length : 0);

async function waitForInvalidation(logFile, before) {
  const started = performance.now();
  while (performance.now() - started < INVALIDATE_WAIT_MS) {
    if (countInvalidations(logFile) > before) return true;
    await sleep(50);
  }
  return false;
}

// 兩邊回應是否一致：狀態碼相同；有 body 的比對 body 雜湊（錯誤 JSON 與固定上游內容都是決定性的）；
// 串流比對逐行內容。
export function sameOutcome(b1, c) {
  if (b1.status !== c.status) return false;
  if (b1.lines?.length || c.lines?.length) return JSON.stringify((b1.lines ?? []).map(line => line.text)) === JSON.stringify((c.lines ?? []).map(line => line.text));
  if (b1.status === 0) return true;
  return b1.bodySha256 === c.bodySha256;
}

// 證據只留比對需要的欄位：狀態、雜湊、小型錯誤訊息全文與串流行（固定內容，無秘密）。
function probeView(response) {
  return {
    status: response.status,
    ttfbMs: response.ttfbMs ?? null,
    totalMs: response.totalMs ?? null,
    bodySha256: response.bodySha256 ?? null,
    bodyText: response.lines?.length ? null : (response.bodyText ?? null),
    lines: response.lines?.length ? response.lines : undefined,
    error: response.error ?? null,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const runId = args['run-id'];
  const portBase = Number(args['port-base']);
  const workdir = path.resolve(args.workdir ?? '');
  if (!Number.isInteger(portBase) || portBase < 1024 || portBase > 65000) throw new Error('需要 --port-base');
  if (!args.workdir || workdir.toLowerCase() === path.resolve(ROOT).toLowerCase()) throw new Error('--workdir 必須是隔離 checkout，不得是主工作區');

  // 前置檢查（認領 run-id 之前）：產品樹等於 30dfdb2、沒有會被當成函式的未追蹤檔、沒有既有測試檔。
  const head = git(workdir, ['rev-parse', 'HEAD']).trim();
  const productBefore = productState(workdir);
  if (!productClean(productBefore)) throw new Error(`workdir 產品樹不等於 ${BASELINE_COMMIT}：${JSON.stringify(productBefore)}，拒絕執行`);
  const preexisting = PREEXISTING_FORBIDDEN.filter(name => fs.existsSync(path.join(workdir, name)));
  if (preexisting.length) throw new Error(`workdir 已有 ${preexisting.join('、')}，拒絕覆寫`);

  const { evidenceDir, runtimeDir } = claimRun({ ticket: TICKET, runId });
  const originals = Object.fromEntries([LIB_FILE, CHART_FILE, SEARCH_FILE].map(file => [file, fs.readFileSync(path.join(workdir, file))]));
  const created = [];
  const raw = {
    schemaVersion: 1, runId, kind: 'reload', createdAt: new Date().toISOString(),
    identity: {
      git: { head },
      workdir: forwardSlashes(workdir),
      productBefore,
      versions: toolVersions(),
      tools: toolHashes(),
      reloadTool: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
      persistentSha256: fileSha(PERSISTENT),
      preloadSha256: fileSha(PRELOAD),
    },
    protocol: { longStream: LONG_STREAM_AI, invalidateWaitMs: INVALIDATE_WAIT_MS, editSettleMs: EDIT_SETTLE_MS, verifierSha: VERIFIER_SHA },
    steps: [], services: [], b1Crashes: [], persistent: null, cleanup: null, aborted: null,
  };
  const services = {};
  const started = [];
  const controlPath = path.join(runtimeDir, 'control.json');
  const control = createFixtureControl(controlPath, { clockOffsetMs: 0, script: {}, delayMs: {}, ai: {} });
  // 改檔工具：只動本工具列管的三個產品檔與測試用 .env，還原一律寫回原位元組。
  const workspace = {
    text: file => originals[file].toString('utf8'),
    write: (file, content) => fs.writeFileSync(path.join(workdir, file), content),
    restore: file => fs.writeFileSync(path.join(workdir, file), originals[file]),
    remove: file => fs.rmSync(path.join(workdir, file)),
    writeEnv: content => fs.writeFileSync(path.join(workdir, '.env'), content),
  };
  try {
    // .vercel 連結複本只為讓 vercel dev 不詢問專案設定。vercel dev 在專案根目錄沒有 .env 時會改用連結專案的
    // 雲端環境變數（可能含真秘密）；本工具一定先寫入只含測試值的 .env 才起服務，所以不會載入雲端環境變數。
    fs.mkdirSync(path.join(workdir, '.vercel'));
    created.push(path.join(workdir, '.vercel'));
    for (const name of ['project.json', 'README.txt']) {
      const from = path.join(ROOT, '.vercel', name);
      if (fs.existsSync(from)) {
        fs.copyFileSync(from, path.join(workdir, '.vercel', name));
        created.push(path.join(workdir, '.vercel', name));
      }
    }
    workspace.writeEnv(TEST_ENV);
    created.push(path.join(workdir, '.env'));
    control.set();

    // 起一個 vercel dev；instance 用來區分 B1 崩潰後重起的新實例（新埠、新 trace 目錄）。
    const startOne = async (label, port, requires, instance) => {
      const name = instance ? `${label}-${instance}` : label;
      const traceDir = path.join(runtimeDir, `${name}-trace`);
      fs.mkdirSync(traceDir);
      const logFile = path.join(runtimeDir, `${name}-vercel.log`);
      const service = { label, name, port, svc: null, traceDir, logFile };
      await startVercelDev({
        label: name,
        port,
        runtimeDir,
        logFile,
        requires,
        cwd: workdir,
        env: probeEnv({ traceDir, fixture: { delayMs: 10, controlPath } }),
        onStarted: svc => {
          service.svc = svc;
          started.push(service);
        },
      });
      return service;
    };
    services.b1 = await startOne('b1', portBase, [PRELOAD], 0);
    services.c = await startOne('c', portBase + 1, [PERSISTENT, PRELOAD], 0);

    // B1 崩潰（程序已結束）時記錄下來，改在新埠重起，後續步驟才有活的參照。
    let nextPort = portBase + 2;
    const ensureB1 = async stepId => {
      if (!services.b1.svc.exit) return;
      const logTail = fs.readFileSync(services.b1.logFile, 'utf8').split(/\r?\n/).filter(line => /Error|taskkill/.test(line)).slice(-4);
      raw.b1Crashes.push({ beforeStep: stepId, exit: services.b1.svc.exit, port: services.b1.port, logErrors: logTail });
      services.b1 = await startOne('b1', nextPort, [PRELOAD], raw.b1Crashes.length);
      nextPort += 1;
    };
    // 候選絕不能崩潰；B1 崩潰是日常入口的既有行為，記為發現後重起。
    const ensureAlive = async stepId => {
      if (services.c.svc.exit) throw new Error(`候選 vercel dev 在 ${stepId} 前已結束`);
      await ensureB1(stepId);
    };

    let seq = 0;
    const probe = async (stepId, routes) => {
      const out = [];
      for (const route of routes) {
        await ensureAlive(stepId);
        seq += 1;
        const b1 = await sendRequest({ port: services.b1.port, route, trace: `${runId}-b1-${seq}` });
        const c = await sendRequest({ port: services.c.port, route, trace: `${runId}-c-${seq}` });
        out.push({ route, b1: probeView(b1), c: probeView(c), b1Instance: services.b1.name, same: sameOutcome(b1, c) });
        // 讓 B1 在回應結束後的收尾（殺子程序）有機會發生，崩潰才會在下一支請求前被偵測到。
        await sleep(300);
      }
      return out;
    };
    const recordStep = (step, invalidated, probes, observed = {}) => {
      raw.steps.push({ step: step.id, invalidated, probes, observed, checks: step.checks(probes, observed) });
    };

    for (const step of STEPS.filter(item => !item.stream)) {
      if (!step.apply) {
        recordStep(step, null, await probe(step.id, step.routes));
        continue;
      }
      const before = countInvalidations(services.c.logFile);
      step.apply(workspace);
      const invalidated = await waitForInvalidation(services.c.logFile, before);
      await sleep(EDIT_SETTLE_MS);
      recordStep(step, invalidated, await probe(step.id, step.routes));
    }

    // 串流進行中改碼：兩邊同時開 50 秒的假串流，候選收到第 2 段後改 api/ 檔案；兩邊都必須完整跑完、
    // 內容一致；之後還原檔案。
    const streamStep = STEP_BY_ID.get('edit-during-stream');
    await ensureAlive(streamStep.id);
    control.set({ ai: LONG_STREAM_AI });
    const streamSend = (port, trace) => sendRequest({
      port, method: 'POST', route: STREAM_ROUTE, headers: { 'Content-Type': 'application/json' }, body: STREAM_BODY,
      stream: true, timeoutMs: LONG_STREAM_TIMEOUT_MS, trace,
    });
    const streamB1 = streamSend(services.b1.port, `${runId}-b1-stream`);
    const streamC = streamSend(services.c.port, `${runId}-c-stream`);
    const editedAfterSecondDelta = await waitForTraceEvent(services.c.traceDir, ev => ev.trace === `${runId}-c-stream` && ev.ev === 'child.fakeCli.delta' && ev.index >= 2, 30_000);
    const beforeEdit = countInvalidations(services.c.logFile);
    workspace.write(LIB_FILE, `${workspace.text(LIB_FILE)}${STREAM_EDIT_MARKER}`);
    const invalidatedDuringStream = await waitForInvalidation(services.c.logFile, beforeEdit);
    const [streamB1Result, streamCResult] = await Promise.all([streamB1, streamC]);
    const beforeRestore = countInvalidations(services.c.logFile);
    workspace.restore(LIB_FILE);
    const invalidatedOnRestore = await waitForInvalidation(services.c.logFile, beforeRestore);
    control.set();
    recordStep(
      streamStep,
      invalidatedDuringStream && invalidatedOnRestore,
      [{ route: STREAM_ROUTE, b1: probeView(streamB1Result), c: probeView(streamCResult), b1Instance: services.b1.name, same: sameOutcome(streamB1Result, streamCResult) }],
      { editedAfterSecondDelta },
    );
    // 串流結束後，已停用的舊子程序要被關掉（不留閒置程序）；等過寬限再停服務讀 log。
    await sleep(6000);
  } catch (error) {
    raw.aborted = error.message;
  } finally {
    for (const s of started) {
      await stopService(s.svc);
      raw.services.push({ label: s.label, name: s.name, port: s.port, ownedPid: s.svc.ownedPid, listenerPid: s.svc.listenerPid, stopped: s.svc.stopped, exit: s.svc.exit });
      if (s.label === 'c') raw.persistent = persistentReport(s.logFile);
      copyTrace(s.traceDir, path.join(evidenceDir, 'trace', s.name));
    }
    // 還原被改的產品檔（位元組比對），刪除本工具建立的測試檔並記錄刪了哪些，最後再核一次產品樹。
    for (const [file, content] of Object.entries(originals)) {
      const full = path.join(workdir, file);
      if (!fs.existsSync(full) || !fs.readFileSync(full).equals(content)) fs.writeFileSync(full, content);
    }
    const deleted = [];
    for (const target of [...created].reverse()) {
      if (!fs.existsSync(target)) continue;
      fs.rmSync(target, { recursive: fs.statSync(target).isDirectory() });
      deleted.push(forwardSlashes(path.relative(workdir, target)));
    }
    const productAfter = productState(workdir);
    raw.cleanup = {
      restored: Object.entries(originals).every(([file, content]) => fs.readFileSync(path.join(workdir, file)).equals(content)),
      deleted,
      productAfter,
      productClean: productClean(productAfter),
      testFilesRemoved: PREEXISTING_FORBIDDEN.every(name => !fs.existsSync(path.join(workdir, name))),
    };
    raw.identityAfter = { head: git(workdir, ['rev-parse', 'HEAD']).trim(), tools: toolHashes() };
    raw.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
  }
  return verifyReload(evidenceDir);
}

export function verifyReload(evidenceDir, { secrets } = {}) {
  const raw = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'raw.json'), 'utf8'));
  const problems = [];
  const diffs = [];
  if (raw.aborted) problems.push(`run 中止：${raw.aborted}`);
  problems.push(...identityProblems(raw.identity, raw.identityAfter, { product: false }));
  if (!raw.identity?.productBefore || !productClean(raw.identity.productBefore)) problems.push('開始時的隔離 checkout 產品樹未核對或不等於 30dfdb2');
  for (const svc of raw.services) {
    if (svc.ownedPid !== svc.listenerPid) problems.push(`${svc.name ?? svc.label} listener PID 非 owned`);
    if (!svc.stopped) problems.push(`${svc.name ?? svc.label} 未確認停止`);
  }
  problems.push(...persistentProblems(raw.persistent, '候選'));
  const cleanup = raw.cleanup ?? {};
  if (!cleanup.restored || !cleanup.productClean || !cleanup.testFilesRemoved) problems.push(`隔離 checkout 未完整還原：${JSON.stringify(cleanup)}`);
  const stepResults = [];
  for (const step of raw.steps) {
    const def = STEP_BY_ID.get(step.step);
    if (!def) {
      problems.push(`未知步驟 ${step.step}`);
      continue;
    }
    if (step.invalidated === false) diffs.push(`${step.step}：候選沒有偵測到變更`);
    for (const probe of step.probes) {
      if (!probe.same) diffs.push(`${step.step} ${probe.route}：B1 ${probe.b1.status} ≠ 候選 ${probe.c.status}`);
    }
    // 條件一律由步驟表從 raw 的探測結果重算，不採信執行當下寫進 raw 的值。
    const checks = def.checks(step.probes, step.observed ?? {});
    for (const [label, ok] of Object.entries(checks)) {
      if (!ok) diffs.push(`${step.step}：${label} 不成立`);
    }
    stepResults.push({ step: step.step, invalidated: step.invalidated, checks, probes: step.probes.map(p => ({ route: p.route, b1: p.b1.status, c: p.c.status, same: p.same })) });
  }
  const missingSteps = STEPS.map(step => step.id).filter(id => !raw.steps.some(step => step.step === id));
  if (!raw.aborted && missingSteps.length) problems.push(`缺少步驟：${missingSteps.join(',')}`);
  const leaks = scanSecrets(evidenceDir, secrets);
  if (leaks.length) problems.push(`證據疑似含秘密：${leaks.map(l => `${l.file}:${l.key}`).join(',')}`);
  const stream = raw.steps.find(step => step.step === 'edit-during-stream');
  const summary = {
    runId: raw.runId,
    steps: stepResults,
    stream: stream ? { cLines: stream.probes[0].c.lines?.length ?? 0, cTotalMs: stream.probes[0].c.totalMs } : null,
    b1Crashes: raw.b1Crashes ?? [],
    spawns: raw.persistent?.spawns ?? [],
    invalidations: raw.persistent?.invalidations ?? null,
    retirements: raw.persistent?.retirements ?? null,
    cleanup: raw.cleanup,
    diffs,
    problems,
  };
  const toolSha = sha256(fs.readFileSync(fileURLToPath(import.meta.url))).slice(0, 12);
  writeOnceOrCompare(path.join(evidenceDir, `reload-summary-${toolSha}-${VERIFIER_SHA}.json`), `${JSON.stringify(summary, null, 2)}\n`, problems);
  console.log(JSON.stringify({ runId: summary.runId, steps: summary.steps.map(s => `${s.step}:${s.probes.map(p => `${p.b1}/${p.c}`).join(',')}${s.invalidated === false ? '（未偵測）' : ''}`), diffs, problems, cleanup: summary.cleanup }, null, 2));
  if (problems.length) return 2;
  return diffs.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const run = args.verify ? Promise.resolve(verifyReload(path.join(EVIDENCE_BASE, TICKET, args.verify))) : main();
  run.then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
