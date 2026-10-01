// 精確 main 整合的清理回歸：實際 shutdown／stopService 路徑，全部依賴是假程序與記憶體檔案。
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as daily from './daily-dev.mjs';
import * as service from './service-kit.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });
const original = { token: 'own', tree: [{ pid: 41, creationDate: '/Date(1000)/', name: 'node.exe' }] };
const source = fs.readFileSync(path.join(dir, 'daily-dev.mjs'), 'utf8');
const block = source.slice(source.indexOf('  const shutdown = async () => {'), source.indexOf("  process.on('SIGINT'"));
for (const [name, cleanup, state, expected] of [
  ['殘留程序保留復原身分', { left: original.tree, error: null }, original, 1],
  ['程序表失敗不可宣稱成功', { left: [], error: 'fixture CIM failure' }, original, 1],
  ['成功才能移除自己狀態', { left: [], error: null }, original, 0],
  ['失敗不得改別人的狀態', { left: original.tree, error: null }, { token: 'foreign' }, 1],
]) {
  let saved = structuredClone(state);
  let removed = false;
  const context = { stopping: false, process: { pid: 9, exitCode: null }, tree: original.tree,
    records: [], watchdog: null, server: null, token: 'own', stateFile: 'memory-state',
    processTable: () => new Map(), mergeTree: (...lists) => lists.flat(), descendantsOf: () => [],
    stopOwned: async () => {}, killTree: async () => cleanup, stopWatchdog: async () => null,
    readState: () => saved, cleanupState: daily.cleanupState,
    fs: { rmSync: () => { removed = true; saved = null; },
      writeFileSync: (_file, data) => { saved = JSON.parse(data); } }, console: { error: () => {} } };
  await vm.runInNewContext(`${block}\nshutdown();`, context);
  const pass = context.process.exitCode === expected && (expected === 0 ? removed
    : !removed && (state.token === 'foreign' ? saved.token === 'foreign' : saved.cleanupError && saved.tree.length));
  check(name, Boolean(pass), { exitCode: context.process.exitCode, removed, state: saved });
}

const row = (pid, parentPid, birth) => ({ ProcessId: pid, ParentProcessId: parentPid,
  Name: 'node.exe', CreationDate: `/Date(${birth})/` });
const owned = { pid: 41, parentPid: 9, name: 'node.exe', creationDate: '/Date(1000)/' };
if (service.stopService.length < 2 && !fs.readFileSync(path.join(dir, 'service-kit.mjs'), 'utf8').includes('readListeners =')) {
  const text = fs.readFileSync(path.join(dir, 'service-kit.mjs'), 'utf8');
  const stop = text.slice(text.indexOf('export async function stopService('), text.indexOf('// 停止後確認原型'));
  const calls = [];
  const svc = { ownedPid: 41, port: 3201, exit: { code: 0 }, tree: [owned] };
  await vm.runInNewContext(`${stop.replace('export ', '')}\nstopService(svc);`, {
    svc, spawnSync: (...args) => { calls.push(args); return { status: 0 }; },
    performance: { now: () => 0 }, listenerPids: () => [], sleep: async () => {},
  });
  check('PID 重用不可誤殺', calls.length === 0, { calls, stopped: svc.stopped });
  check('非 listener 孤兒不可假成功', !svc.stopped, { calls, stopped: svc.stopped });
} else {
  for (const mode of ['reused', 'orphan', 'late', 'query-error', 'missing-birth', 'foreign-listener']) {
    let table = new Map([[41, row(41, 9, mode === 'reused' ? 2000 : 1000)], [42, row(42, 41, 1500)]]);
    if (mode === 'reused') table.delete(42);
    const calls = [];
    const svc = { name: 'fixture', ownedPid: 41, port: 3201, tree: mode === 'missing-birth' ? [] : [owned], exit: { code: 0 } };
    let error = null;
    try {
      await service.stopService(svc, { readTable: async () => {
        if (mode === 'query-error') throw new Error('fixture CIM failure');
        return table;
      }, terminate: async item => {
        calls.push(item.pid);
        if (mode !== 'orphan') table.delete(item.pid);
        if (mode === 'late' && item.pid === 41) table.set(43, row(43, 42, 1800));
        return { status: mode === 'orphan' ? 1 : 0 };
      }, readListeners: async () => mode === 'foreign-listener' ? [{ pid: 90 }] : [], waitMs: 0 });
    } catch (caught) { error = caught.message; }
    const expectedSuccess = ['reused', 'late'].includes(mode);
    check(`service 清理 ${mode}`, expectedSuccess ? svc.stopped && !error && (mode !== 'reused' || !calls.length)
      && (mode !== 'late' || calls.includes(43)) : !svc.stopped && Boolean(error), { calls, stopped: svc.stopped, error });
  }
}
console.log(JSON.stringify({ checks, passed: checks.filter(item => item.pass).length,
  total: checks.length, realKills: 0 }, null, 2));
process.exitCode = checks.every(item => item.pass) ? 0 : 1;
