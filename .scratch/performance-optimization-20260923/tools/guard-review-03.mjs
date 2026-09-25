#!/usr/bin/env node
// P3／P2 純資料守衛檢查：只注入假程序表與假終止器，不列真程序、不殺真程序、不啟動服務。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { descendantsOf, killTree } from './daily-dev.mjs';
import { descendantTree, identityFields, terminateVerifiedTree } from './port-guard-03.mjs';
import { classifyRequest } from './app-03.mjs';
import { claimRun, fileSha } from './service-kit.mjs';

const { evidenceDir } = claimRun({ ticket: '03', runId: process.argv[2] });
const row = (pid, parent, time) => ({ ProcessId: pid, ParentProcessId: parent, Name: 'fake.exe', CreationDate: `/Date(${time})/` });
const tableOf = rows => new Map(rows.map(item => [item.ProcessId, item]));
const expected = (pid, time) => ({ pid, creationDate: `/Date(${time})/` });
const results = [];
async function check(label, act) {
  try { results.push({ label, pass: true, detail: await act() }); }
  catch (error) { results.push({ label, pass: false, error: error.message }); }
}
for (const [label, enumerate] of [['啟動器', descendantsOf], ['驗收端', descendantTree]]) {
  await check(`${label}：舊子程序與其子孫不列入`, () => {
    const table = tableOf([row(1, 0, 200), row(2, 1, 100), row(3, 2, 300), row(4, 1, 201), row(5, 4, 202)]);
    const actual = enumerate(table, 1).map(item => item.pid);
    assert.deepEqual(actual, [4, 5]);
    return { included: actual, excluded: [2, 3] };
  });
}
for (const [label, cleanup] of [['啟動器', killTree], ['驗收端', terminateVerifiedTree]]) {
  await check(`${label}：根 PID 重用時不擴展、不終止`, async () => {
    const killed = [];
    const result = await cleanup([expected(1, 100)], {
      readTable: () => tableOf([row(1, 0, 200), row(2, 1, 201)]),
      terminate: item => { killed.push(item.pid); return { status: 0 }; },
    });
    assert.deepEqual(killed, []);
    return result;
  });
  await check(`${label}：每次結束重列、保留孤兒、略過已重用成員`, async () => {
    const table = tableOf([row(1, 0, 200), row(2, 1, 100), row(4, 1, 201), row(7, 1, 202)]);
    const killed = [];
    const result = await cleanup([expected(1, 200)], {
      readTable: () => new Map(table),
      terminate: item => {
        killed.push(item.pid);
        table.delete(item.pid);
        if (item.pid === 1) {
          table.set(5, row(5, 4, 203)); // 清理開始後才派生的孫程序。
          table.set(7, row(7, 999, 900)); // 同一 PID 被另一個程序重用。
        }
        return { status: 0 };
      },
    });
    assert.deepEqual(killed, [1, 4, 5]);
    assert.deepEqual([...table.keys()], [2, 7]);
    return { killed, untouched: [...table.keys()], result };
  });
  await check(`${label}：缺建立時間不得終止`, async () => {
    let kills = 0;
    await cleanup([{ pid: 9 }], { readTable: () => new Map([[9, { ProcessId: 9 }]]),
      terminate: () => { kills += 1; return { status: 0 }; } });
    assert.equal(kills, 0);
    return { kills };
  });
}
await check('S2：身分只輸出既定欄位，缺 PID 明列', () => {
  const actual = identityFields(new Map([[1, { ...row(1, 0, 200), CommandLine: 'node C:/fixture/daily-dev.mjs start' }]]), [1, 2]);
  assert.deepEqual(actual, [{ pid: 1, parentPid: 0, creationDate: '/Date(200)/', script: 'daily-dev.mjs' }, { pid: 2, missing: true }]);
  return actual;
});

const script = { requestId: 'prior', url: 'http://localhost:32100/api/finmind?dataset=TaiwanStockInfo',
  route: '/api/finmind?dataset=TaiwanStockInfo', method: 'GET', status: 200, failed: null,
  initiator: { type: 'script' }, finishedAtMs: 10 };
const background = { ...script, requestId: 'background', initiator: { type: 'other' }, status: null,
  failed: { canceled: true, error: 'net::ERR_ABORTED' }, startedAtMs: 20, finishedAtMs: null };
for (const [label, history, request, accepted] of [
  ['先有同網址腳本 200', [script], background, true],
  ['沒有先前成功', [], background, false],
  ['網址不同', [{ ...script, url: `${script.url}&extra=1` }], background, false],
  ['成功發生在本筆開始之後', [{ ...script, finishedAtMs: 21 }], background, false],
  ['先前 200 後仍取消', [{ ...script, failed: background.failed }], background, false],
  ['先前 200 非腳本', [{ ...script, initiator: { type: 'other' } }], background, false],
  ['本筆 HTTP 500', [script], { ...background, status: 500 }, false],
]) {
  await check(`P2：${label}`, () => {
    const result = classifyRequest(request, [request], false, history);
    assert.equal(result.ok, accepted);
    return result;
  });
}
const tools = Object.fromEntries(['guard-review-03.mjs', 'daily-dev.mjs', 'port-guard-03.mjs', 'app-03.mjs']
  .map(file => [file, fileSha(path.join(path.dirname(fileURLToPath(import.meta.url)), file))]));
const raw = { runId: process.argv[2], at: new Date().toISOString(), kind: '純假資料守衛檢查', realProcessKills: 0,
  tools, results, pass: results.every(item => item.pass) };
fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(raw, null, 2));
process.exitCode = raw.pass ? 0 : 1;
