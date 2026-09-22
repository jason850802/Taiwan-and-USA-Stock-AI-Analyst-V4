// P1：保留02～05場景／假HTTP，只轉接執行身分、結果接收與本案獨立輸出。
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { root, tools12, options, requiredManifest, bindingFor, assert } from '../../../reacceptance-fixes/tools/replay-contract.mjs';
import { adaptHarnessSource } from '../../../reacceptance-fixes/tools/replay-harness-adapter.mjs';

const args = options(process.argv.slice(2), ['manifest', 'group']);
const context = requiredManifest(args), group = args.group;
assert(group && Object.keys(args).length === 2, '請指定 --manifest <M> --group <02|03|04|05-before|05-after>');
const runId = randomUUID(), binding = bindingFor(context, group, runId), ticket = binding.replayOf;
const oldDir = path.join(root, `.scratch/optimization-followup/evidence/${ticket}`);
const sourcePath = path.join(oldDir, 'fixture-server.mjs');
const bootstrapHash = binding.toolHashes[`${tools12}/integration-bootstrap.js`];
const bootstrapPath = `/__integration/${runId}/${bootstrapHash}.js`;
const manualFile = '.scratch/reacceptance-fixes/manual-market.mjs';
const manualHash = binding.toolHashes[manualFile];
const manualPath = `/__integration/${runId}/${manualHash}/manual-market.mjs`;
const controlsFile = '.scratch/reacceptance-fixes/viewport-controls.mjs';
const controlsHash = binding.toolHashes[controlsFile];
const controlsPath = `/__integration/${runId}/${controlsHash}/viewport-controls.mjs`;
const manifestFile = path.relative(root, context.file).split(path.sep).join('/');
const bootTag = '<script src="/__fixture/bootstrap.js"></script>';

let source = adaptHarnessSource(readFileSync(sourcePath, 'utf8'), ticket);
source = source.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(sourcePath).href));
source = source.replaceAll("from 'esbuild'", `from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/esbuild/lib/main.js')).href)}`);
assert([...source.matchAll(/\bwriteFile\(/g)].length === 1, '原假站寫入邊界改變');
// 新接收端攔截所有result；舊路徑即使意外到達也只能失敗，不能寫歷史。
source = source.replace(/\bwriteFile\(/g, 'denyLegacyWrite(');
assert(source.includes(bootTag), '原HTML注入點改變');
source = source.replaceAll(bootTag, "' + replayBoot() + '");
const urlMarker = 'const url = new URL(req.url, origin);';
assert(source.split(urlMarker).length === 2, '原路由邊界改變');
source = source.replace(urlMarker, `${urlMarker}\n    if (await replayRoute(req, res, url, origin)) return;`);
assert([...source.matchAll(/\.listen\(/g)].length === 1, '原啟站邊界改變');
source = source.replace('.listen(', '.once(\'listening\', () => replay.markListening(origin)).listen(');
if (ticket === '05') {
  assert(source.includes("const baseline = process.argv.includes('--baseline');"), '05前版選擇點改變');
  source = source.replace("const baseline = process.argv.includes('--baseline');", `const baseline = ${group === '05-before'};`);
}
const contractUrl = pathToFileURL(path.join(root, '.scratch/reacceptance-fixes/tools/replay-contract.mjs')).href;
const prelude = `
import { prepareRun, loadManifest } from ${JSON.stringify(contractUrl)};
const replay = prepareRun(loadManifest(${JSON.stringify(context.file)}), ${JSON.stringify(group)}, ${JSON.stringify(runId)});
const integrationBootstrap = ${JSON.stringify(readFileSync(path.join(root, tools12, 'integration-bootstrap.js'), 'utf8'))};
const integrationHoldings = ${JSON.stringify(readFileSync(path.join(root, tools12, 'holdings-cases.mjs'), 'utf8'))};
const integrationManual = ${JSON.stringify(readFileSync(path.join(root, manualFile), 'utf8'))};
const integrationViewportControls = ${JSON.stringify(readFileSync(path.join(root, controlsFile), 'utf8'))};
const denyLegacyWrite = () => { throw new Error('舊固定目錄輸出已停用'); };
const replayBoot = () => '<script id="p1-replay-binding" type="application/json">'
  + JSON.stringify(replay.binding).replaceAll('<', String.fromCharCode(92) + 'u003c')
  + ${JSON.stringify(`</script><script src="${bootstrapPath}"></script>${bootTag}`)};
function replayJson(res, value, status = 200) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}
async function replayRoute(req, res, url, origin) {
  if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
    replayJson(res, {error:'非本機驗收來源'}, 403); return true;
  }
  if (url.pathname === '/__fixture/result') {
    try {
      if (req.method !== 'POST') { replayJson(res, {error:'結果只接受POST'}, 405); return true; }
      if (req.headers['x-replay-run'] !== replay.binding.runId) { replayJson(res, {error:'頁面runId缺失或已過期'}, 409); return true; }
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 2000000) throw new Error('驗收結果過大'); }
      replayJson(res, replay.accept(JSON.parse(raw), req.headers['x-replay-run']));
    } catch (error) { replayJson(res, {error:error.message}, error.status || 400); }
    return true;
  }
  if (url.pathname === '/__integration/meta') { replayJson(res, replay.binding); return true; }
  const rawPrefix = ${JSON.stringify(`/__integration/raw/${runId}/`)};
  if (${JSON.stringify(group)} === '03' && url.pathname.startsWith(rawPrefix)) {
    try {
      if (req.method !== 'GET') { replayJson(res, {error:'實收raw只接受GET'}, 405); return true; }
      const rawName = decodeURIComponent(url.pathname.slice(rawPrefix.length));
      const raw = replay.serveRaw(rawName);
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
        'X-Replay-Run':replay.binding.runId,'X-Replay-Raw-Sha256':raw.sha256});
      res.end(raw.bytes); return true;
    } catch (error) { replayJson(res, {error:error.message}, error.status || 400); return true; }
  }
  if (${JSON.stringify(['04', '05'].includes(ticket))} && url.pathname === replay.artifactPath('holdings.js')) {
    try {
      const bytes = replay.serveArtifact('holdings.js');
      res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store',
        'X-Replay-Run':replay.binding.runId, 'X-Replay-Artifact-Sha256':replay.binding.artifactHashes['holdings.js']});
      res.end(bytes);
    } catch (error) { replayJson(res, {error:error.message}, error.status || 409); }
    return true;
  }
  if (url.pathname === '/__fixture/holdings.js') { replayJson(res, {error:'請完整重載本run的版本化建置產物'}, 410); return true; }
  if (url.pathname.startsWith('/__integration/')) {
    const script = url.pathname === ${JSON.stringify(bootstrapPath)} ? { body: integrationBootstrap, hash: ${JSON.stringify(bootstrapHash)} }
      : ${JSON.stringify(group)} === '03' && url.pathname === ${JSON.stringify(manualPath)} ? { body: integrationManual, hash: ${JSON.stringify(manualHash)} }
        : ${JSON.stringify(group)} === '03' && url.pathname === ${JSON.stringify(controlsPath)} ? { body: integrationViewportControls, hash: ${JSON.stringify(controlsHash)} } : null;
    if (script === null) { replayJson(res, {error:'此頁面bootstrap執行版本已過期；請完整重載本輪頁面'}, 410); return true; }
    res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store',
      'X-Replay-Run':replay.binding.runId,'X-Replay-Tool-Sha256':script.hash}); res.end(script.body); return true;
  }
  if (${JSON.stringify(ticket)} === '04' && url.pathname === '/__fixture/browser-cases.mjs') {
    res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}); res.end(integrationHoldings); return true;
  }
  if (url.pathname === '/viewport') {
    const size = url.searchParams.get('size');
    if (!['desktop','narrow'].includes(size)) { replayJson(res, {error:'尺寸必須明確指定'}, 400); return true; }
    const width = size === 'narrow' ? 390 : 1440, height = size === 'narrow' ? 844 : 900;
    const target = new URL(url.searchParams.get('path') || '/', origin);
    if (target.origin !== origin || !['/', '/harness'].includes(target.pathname)) { replayJson(res, {error:'非法宿主路徑'}, 403); return true; }
    const src = (target.pathname + target.search).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'"});
    const manualControl = ${JSON.stringify(group)} === '03' && target.pathname === '/' && target.searchParams.get('manual') === 'market';
    let controls = '';
    if (manualControl) {
      const rawFile = size + '-manual-market.json';
      const controlBinding = { schema:'p1-viewport-control-v1', manifest:${JSON.stringify(manifestFile)}, group:'03', runId:${JSON.stringify(runId)},
        size, payloadName:'manual-market', rawFile, rawPath:rawPrefix + encodeURIComponent(rawFile),
        bootstrapPath:${JSON.stringify(bootstrapPath)}, manualPath:${JSON.stringify(manualPath)}, controlsPath:${JSON.stringify(controlsPath)} };
      controls = '<section id="p1-controls" aria-label="P1瀏覽器驗收控制" style="box-sizing:border-box;width:'+width+'px;padding:12px;font:14px sans-serif;background:#f4f4f5">'
        + '<div style="display:flex;flex-wrap:wrap;gap:8px">'
        + '<button data-action="begin">開始 manual</button><button data-action="record-clear">記錄 原生清空</button>'
        + '<button data-action="record-option">記錄 搜尋選項</button><button data-action="record-tw">記錄 原生方向鍵選股</button>'
        + '<button data-action="record-us">記錄 原生輸入美股</button><button data-action="record-1wk">記錄 週期 1wk</button>'
        + '<button data-action="record-60m">記錄 週期 60m</button><button data-action="record-1d">記錄 週期 1d</button>'
        + '<button data-action="before-zoom">記錄 縮放前</button><button data-action="finish">完成並保存 raw</button>'
        + '<button data-action="retry-duplicate">P08 同case重送</button><button data-action="observe-restart">P05 跨重啟觀測</button></div>'
        + '<h2>控制狀態</h2><pre id="p1-control-status"></pre><h2>P08 觀測</h2><pre id="p1-p08-observation"></pre>'
        + '<h2>P05 觀測</h2><pre id="p1-p05-observation"></pre></section>'
        + '<script id="p1-viewport-control-binding" type="application/json">'+JSON.stringify(controlBinding).replaceAll('<','\\u003c')+'</script>'
        + '<script type="module" src="${controlsPath}"></script>';
    }
    res.end('<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>P1驗收 '+size+'</title></head><body style="margin:0"><iframe id="app" title="整合驗收App" style="display:block;border:0" width="'+width+'" height="'+height+'" src="'+src+'"></iframe>'+controls+'</body></html>'); return true;
  }
  return false;
}
`;
// 原場景仍由原檔編譯；只在記憶體轉接，不產生或覆寫任何02～11工具。
await import(`data:text/javascript;base64,${Buffer.from(prelude + source).toString('base64')}`);
