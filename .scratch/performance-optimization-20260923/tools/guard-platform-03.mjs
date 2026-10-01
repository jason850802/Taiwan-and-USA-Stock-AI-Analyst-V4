// 平台判定守衛：只用假事件與本機來源，不部署、不開服務、不殺程序。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimRun, fileSha } from './service-kit.mjs';
import { deploymentSettings, platformEvents, canceledWorkStopped, verifiedDeployment, validPayload } from './platform-03.mjs';
const config = { functions: { 'api/**/*.ts': { supportsCancellation: true } } };
const trace = 'platform03-guard-1';
const client = { trace, canceled: true };
const event = name => ({ trace, event: name });
const green = [event('child.fakeCli.spawn'), event('child.fakeCli.kill'), event('request-aborted')];
const checks = [];
const check = (name, fn) => { try { fn(); checks.push({ name, pass: true }); } catch (error) { checks.push({ name, pass: false, error: error.message }); } };
check('保留串流 200 秒', () => assert.deepEqual(deploymentSettings(config, 'export const maxDuration = 200;'), { supportsCancellation: true, maxDuration: 200 }));
check('保留非串流 120 秒', () => assert.equal(deploymentSettings(config, 'export const maxDuration = 120;').maxDuration, 120));
check('無時限常數時不猜新值', () => assert.deepEqual(deploymentSettings(config, 'export default function handler() {}'), { supportsCancellation: true }));
check('缺旗標拒絕', () => assert.throws(() => deploymentSettings({}, '')));
check('旗標關閉拒絕', () => assert.throws(() => deploymentSettings({ functions: { 'api/**/*.ts': { supportsCancellation: false } } }, '')));
check('未核准覆蓋值拒絕', () => assert.throws(() => deploymentSettings({ functions: { 'api/**/*.ts': { supportsCancellation: true, maxDuration: 30 } } }, '')));
check('動態時限拒絕', () => assert.throws(() => deploymentSettings(config, 'export const maxDuration = getDuration();')));
check('同筆取消成功', () => assert.equal(canceledWorkStopped(client, green), true));
check('只取消客戶端不足', () => assert.equal(canceledWorkStopped(client, []), false));
check('沒有上游啟動不能宣稱 kill 成功', () => assert.equal(canceledWorkStopped(client, green.slice(1)), false));
check('沒有中止訊號不足', () => assert.equal(canceledWorkStopped(client, green.slice(0, 2)), false));
check('其他請求 kill 不得誤收', () => assert.equal(canceledWorkStopped(client, green.map(item => ({ ...item, trace: 'other' }))), false));
check('done 與 kill 同在拒絕', () => assert.equal(canceledWorkStopped(client, [...green, event('child.fakeCli.done')]), false));
check('完成回應後 kill 拒絕', () => assert.equal(canceledWorkStopped(client, [...green, event('response-finish')]), false));
const quietEnd = [
  { ...event('child.fakeCli.spawn'), atMs: 1 },
  { ...event('response-close'), finished: false, atMs: 2 },
  { ...event('child.fakeCli.kill'), atMs: 3 },
  { ...event('response-finish'), atMs: 4 },
];
check('斷線且 kill 後靜默收尾可通過', () => assert.equal(canceledWorkStopped(client, quietEnd), true));
check('收尾早於 kill 拒絕', () => assert.equal(canceledWorkStopped(client, quietEnd.map(item => item.event === 'response-finish' ? { ...item, atMs: 2.5 } : item)), false));
check('kill 後仍出字拒絕', () => assert.equal(canceledWorkStopped(client, [...quietEnd, { ...event('child.fakeCli.delta'), atMs: 3.5 }]), false));
check('靜默收尾缺斷線時間拒絕', () => assert.equal(canceledWorkStopped(client, quietEnd.map(item => item.event === 'response-close' ? { ...item, atMs: undefined } : item)), false));
check('沒有客戶端取消拒絕', () => assert.equal(canceledWorkStopped({ ...client, canceled: false }, green), false));
const message = JSON.stringify({ marker: 'perf03-platform', trace, event: 'request-aborted', atMs: 1 });
check('同部署事件去重', () => assert.equal(platformEvents([{ deploymentId: 'dpl1', message, logs: [{ message }] }], 'dpl1', 'platform03-guard').length, 1));
check('別的部署不能充當證據', () => assert.equal(platformEvents([{ deploymentId: 'other', message }], 'dpl1', 'platform03-guard').length, 0));
check('缺 trace 不推定', () => assert.equal(platformEvents([{ deploymentId: 'dpl1', message: JSON.stringify({ marker: 'perf03-platform', event: 'request-aborted' }) }], 'dpl1', 'platform03-guard').length, 0));
const deployment = { prepareSha256: 'hash1', deployment: { id: 'dpl_test1', url: 'https://fixture.vercel.app', target: null } };
check('只接受綁定包的同網址 Preview', () => assert.equal(verifiedDeployment(deployment, 'hash1', 'https://fixture.vercel.app'), 'dpl_test1'));
check('錯網址在網路前拒絕', () => assert.throws(() => verifiedDeployment(deployment, 'hash1', 'https://other.vercel.app')));
check('正式部署拒絕', () => assert.throws(() => verifiedDeployment({ ...deployment, deployment: { ...deployment.deployment, target: 'production' } }, 'hash1', 'https://fixture.vercel.app')));
check('其他包雜湊拒絕', () => assert.throws(() => verifiedDeployment(deployment, 'other', 'https://fixture.vercel.app')));
check('AI 空文字 200 不能通過', () => assert.equal(validPayload({ route: '/api/gemini', status: 200, text: '{"text":""}' }), false));
check('錯股票 200 不能通過', () => assert.equal(validPayload({ route: '/api/yahoo/chart?symbol=AAPL', status: 200, text: '{"chart":{}}' }), false));
check('429 錯 code 不能通過', () => assert.equal(validPayload({ route: '/api/yahoo/chart', status: 429, text: '{"code":"BAD_REQUEST","message":"固定"}' }), false));
check('FinMind 期望不依 shell 的 App 開關', () => {
  const previous = process.env.PERF03_TEST_APP;
  try {
    delete process.env.PERF03_TEST_APP;
    const text = JSON.stringify({ msg: 'success', status: 200, data: [
      { stock_id: '2330', stock_name: '固定資料台積電', industry_category: '半導體業', type: 'twse' },
      { stock_id: '0050', stock_name: '固定資料元大台灣50', industry_category: 'ETF', type: 'twse' },
      { stock_id: '2317', stock_name: '固定資料鴻海', industry_category: '其他電子業', type: 'twse' },
    ] });
    assert.equal(validPayload({ route: '/api/finmind?dataset=TaiwanStockInfo', status: 200, text }), true);
  } finally { if (previous === undefined) delete process.env.PERF03_TEST_APP; else process.env.PERF03_TEST_APP = previous; }
});
const summary = { pass: checks.every(item => item.pass), checks, realNetworkCalls: 0, realProcessKills: 0 };
if (process.argv[2] !== '--check') {
  const runId = process.argv[2];
  const { evidenceDir } = claimRun({ ticket: '03', runId });
  const directory = path.dirname(fileURLToPath(import.meta.url));
  Object.assign(summary, { runId, tools: Object.fromEntries(['guard-platform-03.mjs', 'platform-03.mjs'].map(file => [file, fileSha(path.join(directory, file))])) });
  fs.writeFileSync(path.join(evidenceDir, 'raw.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ pass: summary.pass, checks: checks.length, failed: checks.filter(item => !item.pass) }));
process.exitCode = summary.pass ? 0 : 1;
