'use strict';
// 02 票原型：讓本機 vercel dev 的 Node 函式子程序長駐，跨請求重用同一個 handler 程序。
//
// 用法（只在需要時注入，不改日常預設）：
//   NODE_OPTIONS=--require "<本檔正斜線路徑>" vercel dev --listen 127.0.0.1:<port>
//
// 作法：vercel dev 以 require 載入 @vercel/node builder，並對每支函式請求呼叫 builder.startDevServer()；
// 回傳值沒有 persistent 時，回應一結束就殺掉子程序（每請求重新 fork＋載入模組）。本檔只包住
// startDevServer：同一路由＋同一組設定／環境只保留一個子程序，回傳 Builder API 既有的 persistent: true。
// 路由、轉送 header、錯誤頁、.env 載入、handler adapter（req.query／res.json 等）全部沿用 vercel dev
// 與 @vercel/node 原碼，不另寫一套 API。
//
// 安全邊界：
// - 只在 vercel dev 父程序（vc.js dev）的主執行緒作用；函式子程序、tsx loader worker 與其他 node 程序不作用。
// - 版本不符或找不到接縫時直接拋錯，讓 vercel dev 啟動失敗；若仍有函式子程序不是經由原型啟動，寫出警告。
// - api/ 或根目錄設定檔變更時立刻停用全部子程序：新請求改走新子程序；舊子程序等寬限、且轉送中的請求
//   全部結束後才優雅關閉（上限 RETIRE_MAX_WAIT_MS），不切斷進行中的長串流。只有大小或修改時間真的變了
//   才算變更：Windows 讀檔更新「上次存取時間」也會觸發 fs.watch，不能因此重啟子程序。
// - 交給 vercel dev 的 shutdown 先確認子程序仍存活，避免停止時對已被 Windows 重用的 PID 呼叫 treeKill。
// - 不記錄環境變數值；設定指紋只在記憶體比對。
// - 不修改任何安裝檔。

const EXPECTED_VERSIONS = Object.freeze({ vercel: '55.0.0', vercelNode: '5.8.23' });
// 會影響函式行為的根目錄檔案；api/ 目錄則整棵遞迴監看。
const ROOT_WATCH_FILES = ['.env', '.env.build', 'tsconfig.json', 'package.json', 'package-lock.json', 'vercel.json', '.vercelignore'];
const INVALIDATE_DEBOUNCE_MS = 50;
// 停用後的寬限：已拿到舊子程序埠、尚未連上的請求仍能完成；新請求一律改走新子程序。
const RETIRE_GRACE_MS = 5000;
// 停用後等待轉送中請求結束的上限（Vercel 函式最長執行 300 秒，另留餘裕）；逾時仍關閉並記警告。
const RETIRE_MAX_WAIT_MS = 310_000;
const RETIRE_POLL_MS = 250;

// log 格式集中在這裡：原型寫出與量測工具解析都用同一組標記，不各自拼字串。
const LOG_PREFIX = '[persistent-functions]';
const LOG = Object.freeze({
  enabled: `${LOG_PREFIX} 已啟用`,
  takenOver: `${LOG_PREFIX} startDevServer 已由長駐原型接手`,
  spawn: `${LOG_PREFIX} 啟動`,
  invalidation: `${LOG_PREFIX} 偵測到變更`,
  retire: `${LOG_PREFIX} 關閉已停用的`,
  retireTimeout: `${LOG_PREFIX} 等待轉送中請求逾時，仍關閉`,
  shutdownFailed: `${LOG_PREFIX} 關閉子程序失敗`,
  outsideFork: `${LOG_PREFIX} 警告：偵測到未經長駐原型啟動的函式子程序`,
  spawnPattern: /\[persistent-functions\] 啟動 (\S+) pid=(\d+) generation=(\d+)/,
});

function isVercelDevParent(argv = process.argv, env = process.env) {
  if (env.VERCEL_DEV_ENTRYPOINT) return false;
  return /[\\/]vercel[\\/]dist[\\/]vc\.js$/i.test(argv[1] || '') && argv.includes('dev');
}

function isVercelDevChild(argv = process.argv, env = process.env) {
  return Boolean(env.VERCEL_DEV_ENTRYPOINT)
    && /[\\/]@vercel[\\/]node[\\/]dist[\\/]dev-server\.mjs$/i.test(argv[1] || '');
}

// @vercel/node 5.8.23 的 dev-server 轉送請求時沒有傳 AbortSignal。只在該版本的
// 本機函式子程序內包住 proxy listener 與 undici.request，讓瀏覽器斷線傳到 handler socket。
function installCancellationBridge() {
  const { AsyncLocalStorage } = require('node:async_hooks');
  const { createRequire, syncBuiltinESMExports } = require('node:module');
  const fs = require('node:fs');
  const http = require('node:http');
  const path = require('node:path');
  const childFile = path.resolve(process.argv[1]);
  const packageFile = path.resolve(path.dirname(childFile), '..', 'package.json');
  const version = JSON.parse(fs.readFileSync(packageFile, 'utf8')).version;
  if (version !== EXPECTED_VERSIONS.vercelNode) {
    throw new Error(`${LOG_PREFIX} 取消橋接只驗證過 @vercel/node ${EXPECTED_VERSIONS.vercelNode}，目前為 ${version}。`);
  }

  const undici = createRequire(childFile)('undici');
  const context = new AsyncLocalStorage();
  const originalCreateServer = http.createServer;
  const originalRequest = undici.request;
  if (typeof originalRequest !== 'function') throw new Error(`${LOG_PREFIX} 找不到 undici.request 取消接縫。`);

  http.createServer = function persistentCreateServer(...args) {
    const index = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[index];
    if (listener?.name === 'onDevRequest') {
      args[index] = function persistentDevRequest(req, res) {
        const controller = new AbortController();
        const abort = () => {
          if (!controller.signal.aborted) controller.abort();
        };
        req.once('aborted', abort);
        res.once('close', () => {
          if (!res.writableFinished) abort();
        });
        return context.run({ controller, res }, () => listener.call(this, req, res));
      };
    }
    return originalCreateServer.apply(this, args);
  };
  // dev-server 以 ESM 的具名 import 取得 http.createServer；同步內建模組匯出。
  syncBuiltinESMExports();
  undici.request = function persistentUndiciRequest(url, options = {}) {
    const client = context.getStore();
    if (!client) return originalRequest.call(this, url, options);
    const clientSignal = client.controller.signal;
    const signal = options.signal
      ? AbortSignal.any([options.signal, clientSignal])
      : clientSignal;
    return Promise.resolve(originalRequest.call(this, url, { ...options, signal })).then(response => {
      // dev-server 直接 body.pipe(res)，未監聽來源 stream 的 error。取消時 undici
      // 會對 BodyReadable 發出 AbortError；在此收斂它，避免子程序因未處理事件退出。
      response.body?.on('error', error => {
        if (!clientSignal.aborted && !client.res.destroyed) client.res.destroy(error);
      });
      return response;
    });
  };
  log(`${LOG_PREFIX} 函式子程序取消橋接已啟用`);
}

// 轉送目標是否為本機子程序埠：http-proxy 以 url.parse 的結果組 outgoing，host 帶埠（127.0.0.1:<port>）、
// hostname 不帶；兩種寫法都要認得，否則轉送中的請求不會被計入。
function loopbackPort(options) {
  if (!options || typeof options !== 'object') return null;
  const host = String(options.hostname || options.host || '').replace(/:\d+$/, '');
  const port = Number(options.port);
  return port && (host === '127.0.0.1' || host === 'localhost') ? port : null;
}

// 變更過濾：Windows 的 fs.watch 連「上次存取時間」更新都會回報（NTFS 開啟存取時間更新時，讀檔就觸發）；
// 只有大小或修改時間真的變了（含新增、刪除）才算變更。
function createChangeFilter(statSync) {
  const known = new Map();
  const signatureOf = file => {
    try {
      const stat = statSync(file);
      return `${stat.isDirectory() ? 'd' : 'f'}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return 'missing';
    }
  };
  return {
    remember: file => known.set(file, signatureOf(file)),
    changed: file => {
      const next = signatureOf(file);
      const previous = known.get(file);
      known.set(file, next);
      return previous !== next;
    },
  };
}

// 設定指紋：同一路由的 workPath／config／環境任何一項不同，就不能共用子程序。
function fingerprint(opts) {
  return require('crypto').createHash('sha256').update(JSON.stringify({
    entrypoint: opts.entrypoint,
    workPath: opts.workPath,
    config: opts.config,
    publicDir: opts.publicDir ?? null,
    env: opts.meta?.env ?? null,
    buildEnv: opts.meta?.buildEnv ?? null,
  })).digest('hex');
}

// 長駐池：original 是真正的 startDevServer；lookupChild(pid) 回傳 { child, exited } 以追蹤子程序結束；
// inflight(port) 回傳目前轉送到該子程序、尚未結束的請求數；log 收整行文字（以 LOG 標記開頭）。
function createPersistentPool({
  original,
  lookupChild,
  inflight = () => 0,
  log,
  graceMs = RETIRE_GRACE_MS,
  maxWaitMs = RETIRE_MAX_WAIT_MS,
  pollMs = RETIRE_POLL_MS,
}) {
  const pool = new Map();
  let generation = 0;
  let firstUse = true;

  // 寬限後等轉送中的請求歸零才關閉；子程序已結束就不必關。
  const shutdownLater = (entry, reason) => {
    const startedAt = Date.now();
    const attempt = () => {
      if (!entry.result || entry.record?.exited) return;
      const busy = inflight(entry.result.port);
      if (busy > 0 && Date.now() - startedAt < maxWaitMs) {
        setTimeout(attempt, pollMs).unref?.();
        return;
      }
      if (busy > 0) log(`${LOG.retireTimeout}：${entry.entrypoint} pid=${entry.result.pid} 仍有 ${busy} 支`);
      log(`${LOG.retire} ${entry.entrypoint} pid=${entry.result.pid}（${reason}）`);
      Promise.resolve(entry.result.shutdown?.()).catch(error => log(`${LOG.shutdownFailed}：${entry.entrypoint}（${error.message}）`));
    };
    setTimeout(attempt, graceMs).unref?.();
  };

  // 停用：立刻移出 pool（新請求不會再拿到它）；仍在啟動中的等啟動完成再排關閉。
  const retire = (entry, reason) => {
    if (entry.retired) return;
    entry.retired = true;
    entry.retireReason = reason;
    if (pool.get(entry.key) === entry) pool.delete(entry.key);
    if (entry.result) shutdownLater(entry, reason);
  };

  // 每次變更都留紀錄（即使池裡沒有子程序），讓外部能確認監看確實生效。
  const invalidateAll = reason => {
    generation += 1;
    const entries = [...pool.values()];
    for (const entry of entries) retire(entry, reason);
    log(`${LOG.invalidation}（${reason}），停用 ${entries.length} 個子程序；generation=${generation}`);
    return entries.length;
  };

  async function startDevServer(opts) {
    if (firstUse) {
      firstUse = false;
      log(LOG.takenOver);
    }
    const key = fingerprint(opts);
    let entry = pool.get(key);
    if (entry && (entry.generation !== generation || entry.record?.exited)) {
      retire(entry, entry.record?.exited ? '子程序已結束' : '來源已變更');
      entry = null;
    }
    if (!entry) {
      // 同一路由若設定／環境已不同，舊子程序一併停用，避免兩份設定並存。
      for (const other of [...pool.values()]) {
        if (other.entrypoint === opts.entrypoint) retire(other, '設定或環境已變更');
      }
      const created = { key, entrypoint: opts.entrypoint, generation, retired: false, result: null, record: null };
      created.promise = original(opts).then(result => {
        if (!result) {
          if (pool.get(key) === created) pool.delete(key);
          return result;
        }
        created.result = result;
        created.record = lookupChild(result.pid) ?? null;
        created.record?.child?.once?.('exit', () => {
          if (pool.get(key) === created) pool.delete(key);
        });
        log(`${LOG.spawn} ${opts.entrypoint} pid=${result.pid} generation=${created.generation}`);
        if (created.retired) shutdownLater(created, created.retireReason);
        return result;
      }, error => {
        if (pool.get(key) === created) pool.delete(key);
        throw error;
      });
      pool.set(key, created);
      entry = created;
    }
    const current = entry;
    const result = await current.promise;
    if (!result) return result;
    return {
      port: result.port,
      pid: result.pid,
      // vercel dev 停止時會對記錄過的每個 pid 呼叫 shutdown；已結束的程序直接略過，不送 treeKill。
      shutdown: async () => {
        if (current.record?.exited) return;
        await result.shutdown?.();
      },
      persistent: true,
    };
  }

  return { startDevServer, invalidateAll, size: () => pool.size };
}

function log(line) {
  process.stderr.write(`${line}\n`);
}

function install() {
  const { isMainThread } = require('worker_threads');
  if (!isMainThread || !isVercelDevParent()) return;

  const fs = require('fs');
  const path = require('path');
  const http = require('http');
  const childProcess = require('child_process');

  const vercelRoot = path.resolve(path.dirname(process.argv[1]), '..');
  const vercelVersion = JSON.parse(fs.readFileSync(path.join(vercelRoot, 'package.json'), 'utf8')).version;
  const builderPkgPath = require.resolve('@vercel/node/package.json', { paths: [path.join(vercelRoot, 'dist')] });
  const builderPkg = JSON.parse(fs.readFileSync(builderPkgPath, 'utf8'));
  if (vercelVersion !== EXPECTED_VERSIONS.vercel || builderPkg.version !== EXPECTED_VERSIONS.vercelNode) {
    throw new Error(
      `${LOG_PREFIX} 只驗證過 vercel ${EXPECTED_VERSIONS.vercel}／@vercel/node ${EXPECTED_VERSIONS.vercelNode}，`
      + `目前為 ${vercelVersion}／${builderPkg.version}；拒絕啟用，請改回一般 vercel dev 或重新驗證原型。`,
    );
  }

  // 追蹤父程序 fork 出的子程序：知道長駐子程序何時結束；不是經由原型啟動的函式子程序要寫警告。
  const forked = new Map();
  let pendingStarts = 0;
  const origFork = childProcess.fork;
  childProcess.fork = function persistentFork(modulePath, ...rest) {
    const child = origFork.call(this, modulePath, ...rest);
    if (/dev-server\.mjs$/i.test(String(modulePath)) && pendingStarts === 0) {
      log(`${LOG.outsideFork}（pid=${child.pid}）；此子程序會照原行為每請求重建`);
    }
    if (child.pid) {
      const record = { child, exited: false };
      forked.set(child.pid, record);
      child.once('exit', () => {
        record.exited = true;
        if (forked.get(child.pid) === record) forked.delete(child.pid);
      });
    }
    return child;
  };

  // 轉送中請求數：vercel dev 以 http-proxy 呼叫 http.request 把請求送進子程序埠；回應結束、錯誤或
  // 用戶端取消（http-proxy 會中止轉送）都算結束。只數本機埠的請求。
  const inflightByPort = new Map();
  const origRequest = http.request;
  http.request = function persistentTrackedRequest(...args) {
    const req = origRequest.apply(this, args);
    const port = loopbackPort(args.find(arg => arg && typeof arg === 'object' && !(arg instanceof URL)));
    if (port) {
      inflightByPort.set(port, (inflightByPort.get(port) ?? 0) + 1);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        const next = (inflightByPort.get(port) ?? 1) - 1;
        if (next > 0) inflightByPort.set(port, next);
        else inflightByPort.delete(port);
      };
      req.once('response', res => {
        res.once('end', finish);
        res.once('close', finish);
      });
      req.once('error', finish);
      req.once('abort', finish);
      req.once('close', () => {
        if (!req.res) finish();
      });
    }
    return req;
  };

  // 預先載入 builder 並換掉 require 快取中的 exports；vercel dev 之後 require 同一路徑時拿到的是包裝後物件。
  const builderEntry = path.join(path.dirname(builderPkgPath), builderPkg.main || 'index.js');
  const original = require(builderEntry);
  if (typeof original.startDevServer !== 'function') {
    throw new Error(`${LOG_PREFIX} @vercel/node 沒有 startDevServer，接縫不存在，拒絕啟用。`);
  }
  const cacheKey = require.resolve(builderEntry);
  if (!require.cache[cacheKey]) throw new Error(`${LOG_PREFIX} 找不到 @vercel/node 的 require 快取項。`);

  const persistentPool = createPersistentPool({
    original: async opts => {
      pendingStarts += 1;
      try {
        return await original.startDevServer(opts);
      } finally {
        pendingStarts -= 1;
      }
    },
    lookupChild: pid => forked.get(pid),
    inflight: port => inflightByPort.get(port) ?? 0,
    log,
  });
  require.cache[cacheKey].exports = { ...original, startDevServer: persistentPool.startDevServer };

  // 變更監看：api/ 整棵遞迴，根目錄只看會影響函式的設定檔。啟動時先記下現況，之後只認真正的內容變更。
  const cwd = process.cwd();
  const filter = createChangeFilter(fs.statSync);
  let pendingReason = null;
  let timer = null;
  const schedule = reason => {
    pendingReason = pendingReason ?? reason;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const why = pendingReason;
      pendingReason = null;
      persistentPool.invalidateAll(why);
    }, INVALIDATE_DEBOUNCE_MS);
  };
  const apiDir = path.join(cwd, 'api');
  if (fs.existsSync(apiDir)) {
    filter.remember(apiDir);
    for (const entry of fs.readdirSync(apiDir, { recursive: true })) filter.remember(path.join(apiDir, String(entry)));
    fs.watch(apiDir, { recursive: true }, (_event, file) => {
      // 沒有檔名的事件無從比對，保守視為變更。
      if (!file || filter.changed(path.join(apiDir, String(file)))) schedule(`api/${String(file ?? '').replaceAll('\\', '/')}`);
    }).unref();
  }
  for (const name of ROOT_WATCH_FILES) filter.remember(path.join(cwd, name));
  fs.watch(cwd, { recursive: false }, (_event, file) => {
    if (file && ROOT_WATCH_FILES.includes(String(file)) && filter.changed(path.join(cwd, String(file)))) schedule(String(file));
  }).unref();

  log(`${LOG.enabled}（vercel ${vercelVersion}、@vercel/node ${builderPkg.version}）`);
}

if (isVercelDevChild()) installCancellationBridge();
else install();

module.exports = {
  ROOT_WATCH_FILES,
  LOG,
  isVercelDevParent,
  isVercelDevChild,
  loopbackPort,
  createChangeFilter,
  fingerprint,
  createPersistentPool,
};
