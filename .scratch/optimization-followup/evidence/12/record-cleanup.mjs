// 在已由工具停止自己的程序後，確認PID不存在及埠確實拒絕連線，再保存收尾紀錄。
import { connect } from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const [part, pidText, portText] = process.argv.slice(2);
if (!/^(replay-0[2-5]|profile-cache|app-cache|stream|keyboard|health-guard)$/.test(part || '')) throw new Error('未知自建假站');
const pid = Number(pidText), port = Number(portText);
if (!Number.isInteger(pid) || pid < 1 || !Number.isInteger(port) || port < 4176 || port > 4183) throw new Error('PID／port不符');
let processAbsent = false;
try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') processAbsent = true; else throw error; }
const portClosed = await new Promise((resolve, reject) => {
  const socket = connect({ host: '127.0.0.1', port });
  socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('埠檢查逾時，不能假設已關閉')); });
  socket.on('connect', () => { socket.destroy(); resolve(false); });
  socket.on('error', error => error.code === 'ECONNREFUSED' ? resolve(true) : reject(error));
});
const dir = fileURLToPath(new URL('./', import.meta.url));
let startup = null;
try { startup = JSON.parse(readFileSync(path.join(dir, part, 'startup.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (startup && startup.pid !== pid) throw new Error('PID與啟動紀錄不一致');
const result = { fixturePid: pid, origin: `http://127.0.0.1:${port}`, checkedAt: new Date().toISOString(),
  processAbsent, portClosed, startup: startup ? `${part}/startup.json` : '工具exec回傳PID與session；完整啟動識別另在整合紀錄',
  note: '此程式只核對停止結果，不發出終止指令。' };
writeFileSync(path.join(dir, `cleanup-${part}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (!processAbsent || !portClosed) process.exitCode = 1;
