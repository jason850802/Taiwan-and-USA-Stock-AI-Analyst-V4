// 重算修正前／後來源、測試工具及真正編譯宿主指紋，並核對移除後公開狀態。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
const root=fileURLToPath(new URL('../../../../',import.meta.url)),dir=fileURLToPath(new URL('./',import.meta.url));
const hash=v=>createHash('sha256').update(v).digest('hex'),read=name=>JSON.parse(readFileSync(path.join(dir,'health-guard',name),'utf8'));
const assert=(v,m)=>{if(!v)throw Error(m);};
const baseline='8a6f5e4c9ff0f388528f9974fafe5c3bdc02b880',target='components/portfolio/useHealthCheck.ts';
const red=read('red-batch-readd-before.json');
assert(red.passed===false&&red.error.includes('新加入持股收到舊成本')&&red.final.healthResults.AAPL.fullResult.includes('OLD'),'紅燈沒有精確命中已知症狀');
assert(red.final.items.find(r=>r.symbol==='AAPL').totalCostUSD===200,'紅燈未更換持股');
const old=execFileSync('git',['show',`${baseline}:${target}`],{cwd:root,encoding:'utf8'});
assert(red.sourceHashes[target]===hash(old),'紅燈不是修正前來源');
const compiled=(await build({absWorkingDir:root,entryPoints:[path.join(dir,'health-guard.jsx')],bundle:true,write:false,
  format:'esm',platform:'browser',jsx:'automatic',target:'es2022',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}})).outputFiles[0].contents;
const names=['batch-readd-before','batch-readd-after','batch-error-readd','single-readd','finished-readd','remaining-stock'];
const rows=names.map(name=>{
  const file=`green-${name}.json`,r=read(file);assert(r.passed===true&&r.errors.length===0,`${name}未通過`);
  for(const [file,expected]of Object.entries(r.sourceHashes))assert(hash(readFileSync(path.join(root,file)))===expected,`來源漂移${file}`);
  for(const [file,expected]of Object.entries(r.toolHashes))assert(hash(readFileSync(path.join(dir,file)))===expected,`工具漂移${file}`);
  assert(r.harnessSha256===hash(compiled),'宿主編譯指紋不同');
  if(!['single-readd','remaining-stock'].includes(name))assert(!r.final.healthResults.AAPL,'已移除／重加的A存在舊結果');
  else assert(r.final.healthResults.AAPL.status==='done','有效A結果未交付');
  return {file:`health-guard/${file}`,passed:true,sha256:hash(readFileSync(path.join(dir,'health-guard',file)))};
});
writeFileSync(path.join(dir,'verified-health.json'),JSON.stringify({baseline,beforeSha256:hash(old),afterSha256:hash(readFileSync(path.join(root,target))),
  red:{file:'health-guard/red-batch-readd-before.json',passed:false,sha256:hash(readFileSync(path.join(dir,'health-guard/red-batch-readd-before.json')))},cases:rows},null,2)+'\n');
console.log(JSON.stringify({exactSymptomRed:1,green:rows.length,sourceAndHarnessMatch:true}));
