// 只回填已由commit-map驗證的01～11主線提交；不改歷史原始樣本或自行填入12的自身雜湊。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const map = JSON.parse(readFileSync(new URL('./commits.json', import.meta.url), 'utf8'));
if (map.rows.length !== 11) throw new Error('必須有完整01～11映射');
const changes = [];
for (const row of map.rows) {
  const original = execFileSync('git', ['show', `${row.commit}:${row.issue}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!/^Status: resolved/m.test(original)) throw new Error(`提交未結案：${row.ticket}`);
  const file = path.join(root, row.issue);
  const current = readFileSync(file, 'utf8');
  const status = current.match(/^Status: resolved[^\r\n]*$/m);
  if (!status) throw new Error(`現況票面未結案：${row.ticket}`);
  if (status[0].includes(row.commit)) continue;
  const next = current.replace(status[0], `${status[0]}；最終提交 \`${row.commit}\``)
    + `\n2026-09-21：第12票依Git主線回填最終提交 \`${row.commit}\`；原候選覆核與當時進度說明保留為歷史，整合結果見 [12最終報告](../evidence/12/README.md)。\n`;
  writeFileSync(file, next, 'utf8');
  changes.push(row.ticket);
}
console.log(JSON.stringify({ backfilled: changes, finalTicket: '12另行驗收與提交' }));
