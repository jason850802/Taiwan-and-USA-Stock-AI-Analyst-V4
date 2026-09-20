// 回填前先以實際Git歷史驗證逐票最終提交，不使用中間review候選作基準。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hashes = [
  'ade5dca1e7106c90430efc35b50ba4adaaae8b42', 'c27c4beea4a999f3dc20f2dd109690821379602c',
  'b2e0e4d2903083e193b3ae3b7b83765044327379', '0366f5fb1d58d963323cc9d519f49ec87217a048',
  '12c544f4a58d2fe07b46e523e7ddfc796eb11f12', '513f6347bfb77dedced2b8f5e0d85fef68ed8cbb',
  'd80a8941344a6c3f1e4bdf93c09ce636564a677f', '06aa1cc8268479b8227269519c794be6a47a4f0d',
  '6493c4c78b8282db1dae1202ca94df9aa08e8b40', 'eb1dcfac70094fcbdcdacf9c873b589e5f52c6b4',
  '8a6f5e4c9ff0f388528f9974fafe5c3bdc02b880',
];
const rows = hashes.map((commit, index) => {
  const ticket = String(index + 1).padStart(2, '0');
  if (git(['rev-parse', commit]) !== commit) throw new Error(`不存在的最終提交 ${ticket}`);
  const parent = git(['rev-parse', `${commit}^`]);
  const expectedParent = index ? hashes[index-1] : '5f6b48a9e2a2077539ec8341b2dddb7d45e53d94';
  if (parent !== expectedParent) throw new Error(`非一票一個提交鏈 ${ticket}`);
  const subject = git(['show','-s','--format=%s',commit]);
  const issue = git(['ls-tree','-r','--name-only',commit,'.scratch/optimization-followup/issues']).split('\n').find(p=>p.includes(`/issues/${ticket}-`));
  if (!issue || !git(['show',`${commit}:${issue}`]).includes('Status: resolved')) throw new Error(`最終提交票面未resolved ${ticket}`);
  const review = `.scratch/optimization-followup/evidence/${ticket}/code-review.md`;
  const saved = readFileSync(path.join(root, review), 'utf8');
  if (!saved.includes('Standards') || !saved.includes('Spec')) throw new Error(`缺兩軸紀錄 ${ticket}`);
  return { ticket, commit, parent, subject, issue, review };
});
writeFileSync(new URL('./commits.json', import.meta.url), JSON.stringify({
  original: '5f6b48a9e2a2077539ec8341b2dddb7d45e53d94', rows,
  finalTicket: '12自身提交以交接回覆及Git HEAD取得，不為寫入自身hash反覆改commit。',
}, null, 2) + '\n');
console.log(JSON.stringify({ sequentialFinalCommits: rows.length, resolvedInCommit: rows.length, reviews: rows.length }));
