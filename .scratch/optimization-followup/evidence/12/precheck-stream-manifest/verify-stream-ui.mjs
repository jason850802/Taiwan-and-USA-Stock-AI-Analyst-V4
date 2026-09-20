// 12兩種實際viewport的正式App串流及批次重加回歸，不以Profiler宿主冒充產品頁面。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { reportFor } from '../09/report.mjs';
const root=fileURLToPath(new URL('../../../../',import.meta.url)),dir=fileURLToPath(new URL('./',import.meta.url));
const tools=path.resolve(dir,'../09'),sha=v=>createHash('sha256').update(v).digest('hex');
const assert=(v,m)=>{if(!v)throw Error(m);};
const sourcePaths=JSON.parse(readFileSync(path.join(dir,'audit.json'),'utf8')).files.map(r=>r.path);
const current=Object.fromEntries(sourcePaths.map(file=>[file,sha(readFileSync(path.join(root,file)))]));
const build=sha(readFileSync(path.join(root,'dist/index.html')));
const runId=JSON.parse(readFileSync(path.join(dir,'stream-startup.json'),'utf8')).runId;
assert(typeof runId==='string'&&runId.length>20,'缺少本次串流啟動識別');
const names=['market','empty','single','slow','partial-error','empty-error','paused-frame','cache-hit','switch','restart','view-cancel','health','health-switch','health-unmount','batch-supersede'];
const rows=[];
function binding(r,file){
  assert(r.passed===true&&r.profile===false&&r.errors?.length===0,`${file}: 非正式App或失敗`);
  assert(Object.keys(r.sourceHashes).length===sourcePaths.length,`${file}: 來源不全`);
  for(const [p,h]of Object.entries(current))assert(r.sourceHashes[p]===h,`${file}: 來源漂移${p}`);
  for(const [p,h]of Object.entries(r.toolHashes))assert(sha(readFileSync(path.join(tools,p)))===h,`${file}: 工具漂移${p}`);
  for(const p of ['stream-server.mjs','health-app.js','stream-layout.mjs'])assert(r.integrationTools?.[p]===sha(readFileSync(path.join(dir,p))),`${file}: 整合工具漂移${p}`);
  assert(r.integrationRunId===runId,`${file}: 不是本次完整重跑`);
  assert(r.buildIndexSha256===build,`${file}: build漂移`);
}
for(const size of ['desktop','narrow']){
  const width=size==='desktop'?1440:390,height=size==='desktop'?900:844;
  for(const name of names){
    const file=`stream-ui-${size}/app-${name}-0.json`,raw=readFileSync(path.join(dir,file)),r=JSON.parse(raw);
    binding(r,file);assert(r.viewport.width===width&&r.viewport.height===height,`${file}: viewport不符`);
    if(name==='market')assert(r.inputChunks===1000&&r.inputBytes===102400&&r.inputSha256===sha(reportFor('PRIMARY').text)&&r.cachedSha256===r.inputSha256,`${file}: 全文不一致`);
    rows.push({file,passed:true,sha256:sha(raw),width,height});
  }
  const layoutFile=`stream-ui-${size}/layout-final.json`,layout=JSON.parse(readFileSync(path.join(dir,layoutFile),'utf8'));
  assert(layout.width===width&&layout.height===height&&layout.scrollWidth<=width+1&&layout.reportEnd&&layout.tables===1&&layout.rows===2&&layout.listItems===2,`${size}: 完整長報告的最後版面或Markdown不符`);
  assert(layout.buildIndexSha256===build,`${size}: 版面build漂移`);
  for(const [p,h]of Object.entries(current))assert(layout.sourceHashes?.[p]===h,`${size}: 版面來源漂移${p}`);
  for(const p of ['stream-server.mjs','health-app.js','stream-layout.mjs'])assert(layout.integrationTools?.[p]===sha(readFileSync(path.join(dir,p))),`${size}: 版面工具漂移${p}`);
  assert(layout.integrationRunId===runId&&layout.probeSha256===sha(readFileSync(path.join(dir,'stream-layout.mjs'))),`${size}: 版面不是本次已保存探針`);
  const visible=sha(reportFor('PRIMARY').visible.replace(/\s+/g,' ').trim());
  assert(layout.visibleSha256===visible&&layout.expectedSha256===visible,`${size}: 版面全文雜湊不符`);
  rows.push({file:layoutFile,passed:true,sha256:sha(readFileSync(path.join(dir,layoutFile))),width,height});
  const file=`app-healthguard-${size}-0.json`,raw=readFileSync(path.join(dir,file)),r=JSON.parse(raw);
  binding(r,file);assert(r.uiPlanSha256===sha(readFileSync(path.join(dir,'health-app.js'))),`${file}: 真實表單回歸腳本不符`);
  assert(r.viewport.width===width&&r.viewport.height===height&&r.viewport.scrollWidth<=width+1,`${file}: 最後尺寸或版面不符`);
  assert(r.readings[0].lot.totalCostUSD===100&&r.readings[1].lot.totalCostUSD===200&&r.readings[0].lot.id!==r.readings[1].lot.id,`${file}: 未真正改變持股`);
  assert(r.streams.length===2&&r.streams[0].tag==='BATCH-OLD'&&r.streams[1].tag==='HEALTH-NEW'&&r.streams.every(s=>s.doneAt&&!s.held),`${file}: 假串流未完成`);
  rows.push({file,passed:true,sha256:sha(raw),width,height});
}
writeFileSync(path.join(dir,'verified-stream-ui.json'),JSON.stringify({integrationRunId:runId,sourceHashes:current,buildIndexSha256:build,appCases:32,layoutChecks:2,rows},null,2)+'\n');
console.log(JSON.stringify({formalAppCases:32,fullReportLayoutChecks:2,allPassed:true}));
