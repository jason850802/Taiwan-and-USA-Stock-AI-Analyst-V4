// 12沿用09假HTTP與Profiler，新增兩尺寸輸出分流及正式表單健檢回歸；歷史證據不覆寫。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const original = fileURLToPath(new URL('../09/fixture-server.mjs', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const extraHashes = Object.fromEntries(['stream-server.mjs', 'health-app.js', 'stream-layout.mjs'].map(file => [file, sha(readFileSync(path.join(dir, file)))]));
const runId = randomUUID();
writeFileSync(path.join(dir, 'stream-startup.json'), JSON.stringify({ runId, pid: process.pid, startedAt: new Date().toISOString(), tools: extraHashes }, null, 2) + '\n');
for (const size of ['desktop', 'narrow']) mkdirSync(path.join(dir, `stream-ui-${size}`), { recursive: true });
if (process.argv[2] !== '12') throw new Error('只允許第12票輸出');
let source = readFileSync(original, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(original).href));
// 舊站依資料夾篩選會漏掉config；採完整可達產品及建置設定，禁止以相同數量冒充相同來源。
const sourceFiles = [...new Set([...JSON.parse(readFileSync(path.join(dir, 'audit.json'), 'utf8')).files.map(row => row.path), 'vite.config.ts'])].sort();
const sourceDeclaration = /const sourceList = [\s\S]*?\r?\nconst sourceHashes =/;
if ([...source.matchAll(new RegExp(sourceDeclaration.source, 'g'))].length !== 1) throw new Error('09來源清單邊界改變');
source = source.replace(sourceDeclaration, `const sourceList = ${JSON.stringify(sourceFiles)};\nconst sourceHashes =`);
source = source.replace("from 'esbuild'", `from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/esbuild/lib/main.js')).href)}`);
source = source.replace("from './report.mjs'", `from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(original), 'report.mjs')).href)}`);
source = source.replace("from '../07/fixtures.mjs'", `from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(original), '../07/fixtures.mjs')).href)}`);
if ([...source.matchAll(/\bwriteFile\(/g)].length !== 1) throw new Error('09結果寫入邊界改變');
source = source.replace(/\bwriteFile\(/g, 'captureWrite(');
const marker = 'const url = new URL(req.url, origin);';
if (source.split(marker).length !== 2) throw new Error('09路由邊界改變');
source = source.replace(marker, marker + `
    if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) return json(res, {}, 403);
    if (url.pathname === '/__integration/meta') return json(res, { sourceHashes, toolHashes, buildIndexSha256, integrationTools, integrationRunId });
    if (url.pathname === '/__12-health-app.js') { res.writeHead(200, { 'Content-Type':'text/javascript','Cache-Control':'no-store' }); res.end(healthPlan); return; }
    if (url.pathname === '/__12-stream-layout.mjs') { res.writeHead(200, { 'Content-Type':'text/javascript','Cache-Control':'no-store' }); res.end(layoutPlan); return; }
    if (url.pathname === '/__integration/layout' && req.method === 'POST') {
      let raw=''; for await (const part of req) { raw+=part; if(raw.length>16000) throw Error('版面證據過大'); }
      const value=JSON.parse(raw), size=value.width===390?'narrow':value.width===1440?'desktop':null;
      if(!size || value.height!==(size==='narrow'?844:900)) throw Error('版面尺寸錯誤');
      if(value.probeSha256!==integrationTools['stream-layout.mjs']) throw Error('版面量測工具不符');
      await writeFile(path.join(output,'stream-ui-'+size,'layout-final.json'),JSON.stringify({...value,sourceHashes,buildIndexSha256,integrationTools,integrationRunId},null,2)+'\\n');
      return json(res,{saved:size});
    }
    if (url.pathname === '/viewport') {
      const size=url.searchParams.get('size'); if(!['desktop','narrow'].includes(size)) return json(res,{},400);
      const width=size==='narrow'?390:1440,height=size==='narrow'?844:900;
      const target=new URL(url.searchParams.get('path')||'/',origin);
      if(target.origin!==origin || target.pathname!=='/') return json(res,{},403);
      const src=(target.pathname+target.search).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'"});
      res.end('<!doctype html><html lang="zh-TW"><meta charset="utf-8"><title>12串流 '+size+'</title><body style="margin:0"><iframe id="app" title="串流驗收App" style="border:0;display:block" width="'+width+'" height="'+height+'" src="'+src+'"></iframe></body></html>'); return;
    }
`);
const prelude = `
const integrationTools=${JSON.stringify(extraHashes)};
const integrationRunId=${JSON.stringify(runId)};
const healthPlan=${JSON.stringify(readFileSync(path.join(dir, 'health-app.js'), 'utf8'))};
const layoutPlan=${JSON.stringify(readFileSync(path.join(dir, 'stream-layout.mjs'), 'utf8'))};
async function captureWrite(file, content) {
  if(path.dirname(file)!==${JSON.stringify(dir.replace(/[\\/]$/, ''))}) throw Error('輸出範圍錯誤');
  const r=JSON.parse(content), size=r.viewport?.width===390?'narrow':r.viewport?.width===1440?'desktop':null;
  const target=!r.profile && size && !path.basename(file).startsWith('app-healthguard-')
    ? path.join(path.dirname(file),'stream-ui-'+size,path.basename(file)) : file;
  await writeFile(target,JSON.stringify({...r,integrationTools,integrationRunId},null,2)+'\\n');
}
`;
await import(`data:text/javascript;base64,${Buffer.from(prelude + source).toString('base64')}`);
