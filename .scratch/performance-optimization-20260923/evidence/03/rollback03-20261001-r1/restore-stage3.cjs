const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const base = process.cwd();
const cwd = path.join(base, '.scratch/performance-optimization-20260923/rehearsals/rollback03-20261001-r1');
const out = path.join(base, '.scratch/performance-optimization-20260923/evidence/03/rollback03-20261001-r1');
const commands = [];
for (const args of [['revert', '--no-edit', 'a66ca0e321d89ee4b0363befba58949ea51e464f', '300301bab2ba81f8b13987e97cce41551d40fd2e'], ['rev-parse', 'HEAD^{tree}'], ['status', '--porcelain']]) {
  const r = cp.spawnSync('git', ['-c', 'core.commitGraph=false', ...args], { cwd, encoding: 'utf8' });
  commands.push({ at: new Date().toISOString(), args, exit: r.status, stdout: r.stdout, stderr: r.stderr });
  if (r.status !== 0) throw new Error('隔離候選復原失敗');
}
if (commands[1].stdout.trim() !== 'f4b8a2c2eff8b47b88c69a27a4b4a2f901be2ee0' || commands[2].stdout.trim()) throw new Error('隔離候選內容不同');
fs.writeFileSync(path.join(out, 'stage3-red-and-restore.json'), `${JSON.stringify({ reason: '額外靜態守衛誤要求候選存在 --settings；實際 before／after 均為零，與 rollback 無關。保留紅燈，不追認為通過。', originalCommands: 'commands-stage3.json', candidateRestored: true, commands }, null, 2)}\n`, { flag: 'wx' });
