// 僅探測本session瀏覽器按鍵橋接的事件，不是App驗收或成功raw。
import { createServer } from 'node:http';
const page = `<!doctype html><html lang="zh-TW"><meta charset="utf-8"><title>按鍵橋接預檢</title>
<label>探測輸入<input aria-label="探測輸入" value="2330"></label><pre id="events">[]</pre>
<script>const events=[];addEventListener('keydown',event=>{events.push({key:event.key,trusted:event.isTrusted,ctrl:event.ctrlKey});document.querySelector('#events').textContent=JSON.stringify(events)});</script></html>`;
createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); })
  .listen(4183, '127.0.0.1', () => console.log(JSON.stringify({ pid: process.pid, port: 4183, purpose: '按鍵橋接預檢' })));
