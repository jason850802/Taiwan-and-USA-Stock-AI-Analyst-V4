// 12正式App回歸：以真實表單刪除／新增假持股，所有AI經09隔離NDJSON邊界。
import { reportFor } from '/__fixture/report.mjs';
const assert=(v,m)=>{if(!v)throw Error(m);};
const wait=async(test,label)=>{const end=performance.now()+20000;while(!test()){if(performance.now()>end)throw Error(`等待${label}逾時`);await new Promise(r=>setTimeout(r,10));}};
const fixture=()=>window.streamFixture,turn=()=>fixture().turn();
const row=s=>[...document.querySelectorAll('tbody tr')].find(r=>[...r.querySelectorAll('p')].some(p=>p.textContent===s));
const lots=()=>JSON.parse(localStorage.getItem('portfolio_items')||'[]');
const button=(text,root=document)=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text||b.title===text);assert(b&&!b.disabled,`無可用按鈕${text}`);b.click();};
const dialog=()=>document.querySelector('[role=dialog]');
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const normalized=text=>text.replace(/\s+/g,' ').trim();
async function fill(selector,value){const input=dialog().querySelector(selector);assert(input,`缺少輸入${selector}`);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));await turn();}
export async function run(){
  assert(location.origin==='http://127.0.0.1:4182','只准隔離origin');
  const size=innerWidth===390?'narrow':'desktop';
  const result={name:`healthguard-${size}`,profile:false,version:'app',sample:0,passed:false,browser:navigator.userAgent,readings:[]};
  try{
    await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='我的庫存'),'App');
    button('我的庫存');await wait(()=>row('AAPL')&&row('MSFT'),'合成持股');
    const old=lots().find(l=>l.symbol==='AAPL');assert(old.totalCostUSD===100,'原持股成本不符');
    fixture().plans.push({tag:'BATCH-OLD',holdAt:40});button('全部健檢');
    await wait(()=>fixture().streams[0]?.held,'扣住批次');
    result.readings.push({step:'原持股送出批次',lot:old,streams:fixture().streams.length});
    row('AAPL').click();await turn();
    const remove=document.querySelector('svg.lucide-trash-2')?.closest('button')||document.querySelector('svg.lucide-trash2')?.closest('button');
    assert(remove,'找不到移除');remove.click();await turn();button('確認');await wait(()=>!lots().some(l=>l.symbol==='AAPL'),'刪除A');
    button('新增持股');await wait(dialog,'新增視窗');
    await fill('input[placeholder*="AAPL"]','AAPL');
    await fill('input[placeholder="例：185.50"]','20');
    await fill('input[placeholder="例：100"]','10');
    await fill('input[step="0.01"]','0');
    button('確認新增',dialog());await wait(()=>!dialog()&&lots().some(l=>l.symbol==='AAPL'),'重新新增');
    const fresh=lots().find(l=>l.symbol==='AAPL');assert(fresh.id!==old.id&&fresh.totalCostUSD===200,'未真正使用新持股／新成本');
    result.readings.push({step:'真實表單重加',lot:fresh});
    fixture().streams[0].release();await wait(()=>fixture().streams[0].doneAt,'舊批次完成');
    await wait(()=>row('MSFT')?.querySelector('button')&&!row('MSFT').querySelector('button[title=健檢]'),'其他持股正常完成');
    assert(row('AAPL').querySelector('button[title=健檢]'),'舊批次回填新AAPL');
    result.readings.push({step:'舊批次不污染新持股',a:row('AAPL').innerText,m:row('MSFT').innerText});
    fixture().plans.push({tag:'HEALTH-NEW',mode:'single'});row('AAPL').querySelector('button[title=健檢]').click();
    await wait(()=>dialog()?.textContent.includes('報告結束 HEALTH-NEW'),'新持股可重新健檢');
    assert(fixture().streams.length===2,'新成本誤用舊AI快取');
    const node=[...document.querySelectorAll('h1')].find(h=>h.textContent==='合成串流 HEALTH-NEW')?.parentElement;
    assert(node&&normalized(node.innerText)===normalized(reportFor('HEALTH-NEW').visible),'新持股報告不完整');
    assert(!dialog().textContent.includes('BATCH-OLD'),'舊報告出現在新視窗');
    result.newReportSha256=await hash(normalized(node.innerText));
    result.readings.push({step:'新成本重新健檢成功',lot:lots().find(l=>l.symbol==='AAPL'),reportEnd:node.innerText.slice(-150)});
    button('關閉',dialog());await wait(()=>!dialog(),'關閉');
    result.viewport={width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth};
    assert(result.viewport.scrollWidth<=innerWidth+1,'正式App水平溢出');
    assert(fixture().errors.length===0,'非預期例外');result.passed=true;
  }catch(error){result.error=String(error.stack||error);}
  result.uiPlanSha256=await hash(await(await fetch('/__12-health-app.js')).text());
  result.errors=fixture().errors;result.streams=fixture().streams.map(s=>({tag:s.tag,deltas:s.deltas,doneAt:s.doneAt,held:s.held}));
  const saved=await fetch('/__fixture/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`app-healthguard-${size}-0`,result})});
  if(!saved.ok)throw Error('保存正式App回歸失敗');document.title=`12 healthguard ${size}: ${result.passed?'PASS':'FAIL'}`;
  return result;
}
