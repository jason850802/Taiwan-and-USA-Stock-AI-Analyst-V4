// 在正式App完成PRIMARY全文後，直接從DOM量取兩尺寸版面；不接受呼叫端給定讀值。
import { reportFor } from '/__fixture/report.mjs';
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
const normalized = text => text.replace(/\s+/g, ' ').trim();
export async function captureLayout() {
  if (location.origin !== 'http://127.0.0.1:4182' || location.pathname !== '/') throw Error('版面量測只允許正式App假站');
  const heading = [...document.querySelectorAll('h1')].find(node => node.textContent === '合成串流 PRIMARY');
  const report = heading?.parentElement;
  if (!report) throw Error('找不到正式長報告');
  const result = {
    width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    reportEnd: report.innerText.includes('報告結束 PRIMARY'), tables: report.querySelectorAll('table').length,
    rows: report.querySelectorAll('table tbody tr').length, listItems: report.querySelectorAll('li').length,
    visibleSha256: await hash(normalized(report.innerText)), expectedSha256: await hash(normalized(reportFor('PRIMARY').visible)),
    probeSha256: await hash(await (await fetch('/__12-stream-layout.mjs')).text()),
  };
  if (!result.reportEnd || result.visibleSha256 !== result.expectedSha256 || result.scrollWidth > result.width + 1
    || result.tables !== 1 || result.rows !== 2 || result.listItems !== 2) throw Error('實際DOM長報告不完整或版面溢出');
  const saved = await fetch('/__integration/layout', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(result) });
  if (!saved.ok) throw Error('版面量測保存失敗');
  return result;
}
