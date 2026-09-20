// 核對最終入口及本輪回填票面的相對連結，不依賴聊天中已失效的候選雜湊。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const commits = JSON.parse(readFileSync(path.join(dir,'commits.json'),'utf8'));
const files = ['PLAN.md','.scratch/optimization-followup/spec.md','docs/optimization-current.md','docs/optimization-final.md',
  '.scratch/optimization-followup/issues/12-final-acceptance.md','.scratch/optimization-followup/evidence/12/README.md',
  '.scratch/optimization-followup/evidence/12/code-review.md',...commits.rows.map(row=>row.issue)];
const links = [], statuses = [];
for (const file of files) {
  const content = readFileSync(path.join(root,file),'utf8');
  if (file.includes('/issues/')) statuses.push({file,status:content.match(/^Status:\s*(.+)$/m)?.[1]});
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target=match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    const resolved=path.resolve(root,path.dirname(file),decodeURIComponent(target));
    links.push({file,target,exists:existsSync(resolved)});
  }
}
const missing=links.filter(row=>!row.exists);
const incorrectHashes=commits.rows.filter(row=>!readFileSync(path.join(root,row.issue),'utf8').match(/^Status:.*$/m)?.[0].includes(row.commit));
const result={files:files.length,links:links.length,missing,incorrectHashes,statuses};
writeFileSync(path.join(dir,'docs-check.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
if(missing.length||incorrectHashes.length)process.exitCode=1;
