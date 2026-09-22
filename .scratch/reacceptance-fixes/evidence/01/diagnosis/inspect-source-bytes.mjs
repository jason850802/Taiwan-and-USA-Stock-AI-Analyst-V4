// 唯讀釐清Git blob與原工作樹bytes差異；不轉換行尾、不修改來源。
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { root, evidence, sourceFiles, fixedCommit, sha, safeOutput, atomicJson } from '../../../tools/replay-contract.mjs';
const files = sourceFiles();
const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const tree = Object.fromEntries(git(['ls-tree', '-r', fixedCommit]).toString('utf8').trim().split('\n').map(line => {
  const [metadata, file] = line.split('\t'); return [file, metadata.split(' ')[2]];
}));
const working = git(['hash-object', '--no-filters', ...files]).toString('utf8').trim().split('\n');
const mismatches = files.flatMap((file, index) => {
  if (working[index] === tree[file]) return [];
  const bytes = readFileSync(path.join(root, file)), blob = git(['show', `${fixedCommit}:${file}`]);
  return [{ file, gitBlob: tree[file], workingBlob: working[index], gitSha256: sha(blob), workingSha256: sha(bytes),
    equalAfterCrLfNormalization: bytes.toString('utf8').replaceAll('\r\n', '\n') === blob.toString('utf8').replaceAll('\r\n', '\n') }];
});
const directory = safeOutput(`${evidence}/diagnosis/source-bytes-${randomUUID()}`); mkdirSync(directory);
const result = { fixedCommit, checked: files.length, mismatches };
atomicJson(path.join(directory, 'result.json'), result, true);
console.log(JSON.stringify({ output: directory, ...result }));
