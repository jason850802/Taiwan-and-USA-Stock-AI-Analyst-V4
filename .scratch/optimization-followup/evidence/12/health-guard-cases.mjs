// 只經公開hook DOM、實際服務及手動釋放HTTP重現；沒有mock內部函式或讀私有Map。
const names=['batch-readd-before','batch-readd-after','batch-error-readd','single-readd','finished-readd','remaining-stock'];
const state=()=>JSON.parse(document.querySelector('#state')?.textContent||'null');
const assert=(v,m)=>{if(!v)throw Error(m);};
const post=async(path,data={})=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw Error(`${path}/${r.status}`);return r.json();};
const wait=async(test,label)=>{const end=performance.now()+12000;while(!await test()){if(performance.now()>end)throw Error(`等待${label}逾時`);await new Promise(r=>setTimeout(r,10));}};
const turn=()=>new Promise(r=>{const m=new MessageChannel();m.port1.onmessage=()=>{m.port1.close();m.port2.close();r();};m.port2.postMessage(null);});
const click=async id=>{document.getElementById(id).click();await turn();};
const pending=async id=>wait(async()=>{const r=await(await fetch('/state')).json();return r.pending.includes(id);},`AI${id}`);
export async function run(){
  const params=new URLSearchParams(location.search),stage=params.get('stage')||'green',index=Number(params.get('case')||0),name=names[index];
  const result={name,stage,passed:false,readings:[],browser:navigator.userAgent};
  try{
    assert(name,'未知案例');await wait(()=>state(),'宿主');await post('/reset');
    await click(name==='single-readd'?'single':'batch');await pending(1);
    result.readings.push({step:'舊持股送出AI',value:state()});
    if(name==='remaining-stock'){
      await click('remove-other');await post('/release',{id:1});await wait(()=>!state().batchChecking,'批次結束');
      assert(state().healthResults.AAPL?.status==='done','移除他股取消有效AAPL');assert(!state().healthResults.MSFT,'移除他股仍回填');
    }else{
      if(name==='finished-readd'){await post('/release',{id:1});await wait(()=>!state().batchChecking,'原完成');assert(state().healthResults.AAPL?.status==='done','原報告沒完成');}
      await click('remove');
      if(name==='batch-readd-after'){
        await post('/release',{id:1});await wait(()=>!state().batchChecking,'移除時舊批次完成');
        result.readings.push({step:'尚未重加',value:state()});
      }
      await click('restore');assert(state().items.find(i=>i.symbol==='AAPL').totalCostUSD===200,'未真正換新持股成本');
      if(name==='single-readd'){
        await click('single');await pending(2);await post('/release',{id:2});await wait(()=>state().healthResults.AAPL?.status==='done','新單檔完成');
        await post('/release',{id:1});await turn();await turn();
        assert(state().healthResults.AAPL.fullResult.includes('NEW')&&!state().healthResults.AAPL.fullResult.includes('OLD'),'舊單檔覆蓋新持股結果');
      }else{
        if(!['batch-readd-after','finished-readd'].includes(name)){await post('/release',{id:1,fail:name==='batch-error-readd'});await wait(()=>!state().batchChecking,'舊批次完成');}
        assert(!state().healthResults.AAPL,'新加入持股收到舊成本的健檢結果');
        if(name!=='finished-readd')assert(state().healthResults.MSFT?.status===(name==='batch-error-readd'?'error':'done'),'仍存在持股未正常完成');
      }
    }
    result.final=state();assert(window.fixtureErrors.length===0,'未捕捉例外');result.passed=true;
  }catch(error){result.error=String(error.stack||error);result.final=state();}
  result.errors=window.fixtureErrors;
  await post('/result',{name:`${stage}-${name}`,result});document.title=`12 health ${name}: ${result.passed?'PASS':'FAIL'}`;
  if(result.passed&&params.has('auto')&&index+1<names.length)location.search=`?stage=${stage}&case=${index+1}&auto=1`;
}
