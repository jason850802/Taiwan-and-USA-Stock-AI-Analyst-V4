// 只服務4182的合成行情與可手動釋放的AI；本體儲存僅此隔離origin。
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chart, finmind } from '../07/fixtures.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url)), dir = fileURLToPath(new URL('./', import.meta.url));
const output = path.join(dir, 'health-guard'); await mkdir(output, { recursive: true });
const origin = 'http://127.0.0.1:4182', hash = value => createHash('sha256').update(value).digest('hex');
const sourceList = JSON.parse(await readFile(path.join(dir, 'audit.json'), 'utf8')).files.map(r => r.path);
const sourceHashes = Object.fromEntries(await Promise.all(sourceList.map(async file => [file, hash(await readFile(path.join(root, file)))])));
const toolHashes = Object.fromEntries(await Promise.all(['health-guard-server.mjs', 'health-guard.jsx', 'health-guard-cases.mjs', '../07/fixtures.mjs'].map(async file => [file, hash(await readFile(path.join(dir, file)))])));
const bundle = (await build({ absWorkingDir: root, entryPoints: [path.join(dir, 'health-guard.jsx')], bundle: true, write: false,
  format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022', define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].contents;
const binding = { candidate: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceHashes, toolHashes, harnessSha256: hash(bundle), node: process.version };
let requests = [], pending = new Map();
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function body(req) { let s='';for await(const b of req){s+=b;if(s.length>1024*1024)throw Error('body太大');}return JSON.parse(s||'{}'); }
const script = `if(location.origin!==${JSON.stringify(origin)})throw Error('非隔離origin');localStorage.clear();sessionStorage.clear();window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));const D=Date;window.Date=class extends D{constructor(...a){super(...(a.length?a:[D.parse('2026-09-20T04:00:00Z')]));}static now(){return D.parse('2026-09-20T04:00:00Z');}};import('/cases.mjs').then(m=>m.run());`;
createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,origin);
    if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin))return json(res,{},403);
    if(url.pathname==='/state')return json(res,{requests,pending:[...pending.keys()]});
    if(url.pathname==='/reset'&&req.method==='POST'){if(pending.size)return json(res,{},409);requests=[];return json(res,{ok:true});}
    if(url.pathname==='/release'&&req.method==='POST'){const data=await body(req);const finish=pending.get(data.id);if(!finish)return json(res,{},404);finish(data.fail===true);return json(res,{ok:true});}
    if(url.pathname==='/result'&&req.method==='POST'){
      const data=await body(req);if(!/^(red|green)-[a-z-]+$/.test(data.name))return json(res,{},400);
      await writeFile(path.join(output,`${data.name}.json`),JSON.stringify({...data.result,...binding,requests},null,2)+'\n');return json(res,{saved:data.name});
    }
    if(url.pathname==='/api/yahoo/chart')return json(res,chart(url.searchParams.get('symbol'),url.searchParams.get('interval'),80));
    if(url.pathname==='/api/finmind')return json(res,{msg:'success',data:finmind(url.searchParams.get('dataset'),url.searchParams.get('data_id'))});
    if(url.pathname==='/api/gemini-stream'&&req.method==='POST'){
      const payload=await body(req),id=requests.length+1;const record={id,promptHash:hash(JSON.stringify(payload)),status:'pending'};requests.push(record);
      pending.set(id,fail=>{pending.delete(id);record.status=fail?'error':'done';const tag=id===1?'OLD':'NEW';
        const text=`## AAPL\n\n合成 ${tag} 成本情境報告\n\n續抱\n\n## MSFT\n\n合成 ${tag} 其他持股報告\n\n續抱`;
        res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});
        res.end(JSON.stringify(fail?{t:'error',message:'合成批次失敗'}:{t:'delta',text})+'\n'+(fail?'':JSON.stringify({t:'done',text})+'\n'));
      });return;
    }
    if(url.pathname.startsWith('/api'))return json(res,{message:'拒絕真實AI或未知API'},403);
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    let content,type;
    if(url.pathname==='/'){type='text/html; charset=utf-8';content='<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><script src="/bootstrap.js"></script></head><body><div id="root"></div><script type="module" src="/host.js"></script></body></html>';}
    else if(url.pathname==='/bootstrap.js'){type='text/javascript';content=script;}
    else if(url.pathname==='/host.js'){type='text/javascript';content=bundle;}
    else if(url.pathname==='/cases.mjs'){type='text/javascript';content=await readFile(path.join(dir,'health-guard-cases.mjs'));}
    else return json(res,{},404);
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"});res.end(content);
  }catch(error){json(res,{message:error.message},400);}
}).listen(4182,'127.0.0.1',async()=>{const start={...binding,pid:process.pid,origin,startedAt:new Date().toISOString()};await writeFile(path.join(output,'startup.json'),JSON.stringify(start,null,2)+'\n');console.log(JSON.stringify({origin,pid:process.pid,harnessSha256:binding.harnessSha256}));});
