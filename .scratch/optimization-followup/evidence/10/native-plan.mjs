// 原生鍵盤重跑計畫：由 Desktop exec 逐步呼叫 browser_action，頁面不合成鍵盤事件。
// evaluate 僅定位測試起點、等待公開DOM／捲動及讀取證據；所有操作鍵由工具注入。
export function makeNativePlan() {
  const steps = [];
  const E = body => steps.push({ kind: 'evaluate', expression: `(async()=>{const w=document.getElementById('app').contentWindow,d=w.document,f=w.keyboardFixture;${body}})()` });
  const K = (...keys) => keys.forEach(key => steps.push({ kind: 'key', key }));
  const R = (step, checks) => E(`return f.record(${JSON.stringify(step)},${JSON.stringify(checks)});`);
  const S = (name, extra = '{}') => E(`const result=await f.save(${JSON.stringify(name)},${extra});if(!result.passed)throw Error(${JSON.stringify(name)}+' 斷言失敗');return result;`);
  const F = label => E(`for(let i=0;i<200;i++){const b=[...d.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(b&&!b.disabled){b.focus();return;}await new Promise(r=>setTimeout(r,20));}throw Error('找不到來源控制');`);
  const load = (size, page) => {
    const [width, height] = size === 'desktop' ? [1440, 900] : [390, 844];
    steps.push({ kind: 'evaluate', navigation: true, expression: `(async()=>{const frame=document.getElementById('app');frame.width=${width};frame.height=${height};scrollTo(0,0);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('子頁載入逾時')),10000);frame.onload=()=>{clearTimeout(timer);resolve();};frame.src='${page === 'harness' ? '/harness' : '/'}?size=${size}&native='+Date.now();});const w=frame.contentWindow;for(let i=0;i<200;i++){if(w.keyboardFixture&&w.document.querySelector('${page === 'harness' ? '#open' : 'main'}')){w.keyboardFixture.reset();return {loaded:true,width:w.innerWidth,height:w.innerHeight};}await new Promise(r=>setTimeout(r,20));}throw Error('子頁未就緒');})()` });
  };
  for (const size of ['desktop', 'narrow']) {
    const [width, height] = size === 'desktop' ? [1440, 900] : [390, 844];
    load(size, 'harness'); E("d.getElementById('open').focus();"); K('Enter');
    R('初始焦點', { inside: true, active: '關閉', dialogCount: 1, width, height, noOverflow: true });
    K('Shift+Tab'); R('反向至末項', { inside: true, activeId: 'last' });
    E("f.scrolledBottom=d.querySelector('[role=dialog]').firstElementChild.scrollTop>0;");
    K('Tab'); R('正向循環至首項', { inside: true, active: '關閉' });
    K('Tab', 'Enter'); R('停用目前項目', { inside: true, active: '關閉' });
    K('Tab', 'Enter'); R('隱藏目前項目', { inside: true, active: '關閉' });
    K('Tab', 'Tab', 'Tab', 'Enter'); R('內層初始', { inside: true, dialogCount: 2, active: '關閉' });
    K('Shift+Tab'); R('內層反向循環', { inside: true, activeId: 'inner-last', dialogCount: 2 });
    K('Escape'); R('內層關閉回外層來源', { inside: true, dialogCount: 1, activeId: 'inner' });
    K('Escape'); R('外層關閉返回來源', { dialogCount: 0, activeId: 'open', noOverflow: true });
    S(`green-${size}-modal`, '{longContentScrolled:f.scrolledBottom,passed:f.scrolledBottom}');

    load(size, 'harness'); E("d.getElementById('open').focus();"); K('Enter');
    K(...Array(size === 'desktop' ? 3 : 4).fill('Tab')); K('Enter');
    R('來源移除或停用時視窗仍可操作', { inside: true, dialogCount: 1 });
    K('Escape'); R('失效來源回到有效控制', { activeId: 'fallback', dialogCount: 0 });
    K('Tab', 'Enter'); R('空視窗初始', { inside: true, active: '對話視窗', dialogCount: 1 });
    K('Tab', 'Shift+Tab'); R('空視窗正反循環', { inside: true, active: '對話視窗' });
    K('Escape'); R('空視窗返回來源', { activeId: 'empty', dialogCount: 0 });
    K('Enter'); steps.push({ kind: 'backdrop', x: 5, y: 150 });
    R('背景點擊仍可關閉', { activeId: 'empty', dialogCount: 0, noOverflow: true });
    S(`green-${size}-fallback`);

    load(size, 'harness'); E("d.getElementById('conditional').focus();"); K('Enter');
    R('StrictMode條件掛載初始', { inside: true, active: '關閉', dialogCount: 1 });
    K('Shift+Tab'); R('條件掛載末項', { inside: true, activeId: 'conditional-last' });
    K('Tab', 'Escape'); R('重播後返回真正來源', { activeId: 'conditional', dialogCount: 0 });
    K('Enter', 'Escape'); R('再次掛載仍返回來源', { activeId: 'conditional', dialogCount: 0, noOverflow: true });
    S(`green-${size}-conditional`);

    load(size, 'app'); F('AI 分析'); K('Enter');
    R('分析初始', { inside: true, active: '關閉', dialogCount: 1, width, height, noOverflow: true });
    K('Shift+Tab'); R('反向跳過停用送出', { inside: true, active: '持有' });
    K('Tab'); R('分析正向循環', { inside: true, active: '關閉' });
    K('Tab', 'Tab', 'Tab', 'Enter'); R('空手選擇後保留焦點', { inside: true, active: '空手' });
    E("f.enabledStart=!![...d.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='開始 AI 智能分析'&&!b.disabled);");
    K('Escape'); R('分析返回來源', { dialogCount: 0, active: 'AI 分析', noOverflow: true });
    S(`green-${size}-analysis`, '{startEnabled:f.enabledStart,passed:f.enabledStart}');

    load(size, 'app'); F('我的庫存'); K('Enter'); F('新增持股'); E('f.reset();'); K('Enter');
    R('新增初始', { inside: true, active: '關閉', dialogCount: 1, width, height, noOverflow: true });
    K('Shift+Tab'); R('新增反向循環', { inside: true });
    K('Tab'); R('新增正向循環', { inside: true, active: '關閉' });
    K('Tab', 'A', 'A', 'P', 'L'); R('股票鍵盤輸入仍保留焦點', { inside: true, activeTag: 'INPUT' });
    E('f.typed=d.activeElement.value;'); K('Shift+Tab', 'Shift+Tab'); R('動態內容末項', { inside: true });
    E("const box=d.querySelector('[role=dialog]').firstElementChild;f.addScrolled=box.scrollTop>0;f.addScrollValid=box.scrollHeight<=box.clientHeight+1||box.scrollTop>0;");
    K('Tab', 'Escape'); R('新增返回來源', { dialogCount: 0, active: '新增持股', noOverflow: true, bodyOverflow: '' });
    S(`green-${size}-add`, "{typed:f.typed,longContentScrolled:f.addScrolled,passed:f.typed==='AAPL'&&f.addScrollValid}");

    load(size, 'app'); F('我的庫存'); K('Enter'); F('新增持股'); E('f.reset();');
    K('Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab'); R('跨控制項導航到匯入', { active: '匯入對帳單', dialogCount: 0 });
    K('Enter'); R('匯入初始', { inside: true, active: '關閉', dialogCount: 1, noOverflow: true });
    K('Shift+Tab'); R('匯入反向循環', { inside: true }); K('Tab'); R('匯入正向循環', { inside: true, active: '關閉' });
    K('Tab'); R('鍵盤到選檔控制', { inside: true, active: '選擇檔案' });
    K('Escape'); R('匯入返回來源', { dialogCount: 0, active: '匯入對帳單', noOverflow: true });
    S(`green-${size}-import`);

    load(size, 'app'); F('指標'); K('Enter', 'Tab', 'Tab');
    E("f.periodInput=d.activeElement;f.periodBefore=d.activeElement.value;f.record('修改前均線欄位',{active:'第 1 條均線天數',activeTag:'INPUT',width:w.innerWidth,height:w.innerHeight});");
    K('ArrowUp'); R('修改後保持原輸入焦點', { active: '第 1 條均線天數', activeTag: 'INPUT' });
    E('f.periodAfter=d.activeElement.value;f.retained=d.activeElement===f.periodInput;');
    K('Shift+Tab', 'Space'); R('開關操作保持焦點', { active: '顯示第 1 條均線（MA6）', activeTag: 'BUTTON' });
    E("f.pressed=d.activeElement.getAttribute('aria-pressed');f.names=[...d.querySelectorAll('button[aria-pressed],input[aria-label]')].map(e=>({name:f.label(e),role:e.tagName,pressed:e.getAttribute('aria-pressed')}));");
    K('Escape'); R('指標返回來源', { active: '指標', noOverflow: true });
    S(`green-${size}-indicator`, "{periodBefore:f.periodBefore,periodAfter:f.periodAfter,retainedFocus:f.retained,pressed:f.pressed,names:f.names,passed:f.retained&&f.periodBefore==='5'&&f.periodAfter==='6'&&f.pressed==='false'}");
  }
  E('f.reset();');
  const settle = top => E(`const until=performance.now()+5000;while(${top ? 'w.scrollY>1' : 'w.scrollY<1'}){if(performance.now()>until)throw Error('鍵盤捲動未生效');await new Promise(r=>setTimeout(r,20));}`);
  K('Control+Home'); settle(true); R('視窗關閉後返回頁首', { dialogCount: 0, pageScrollY: 0, bodyOverflow: '', noOverflow: true });
  K('Control+End'); settle(false); E('f.pageScrolled=w.scrollY>0;'); R('鍵盤捲動背景長頁', { dialogCount: 0, bodyOverflow: '', noOverflow: true });
  K('Control+Home'); settle(true); R('背景捲動還原', { dialogCount: 0, pageScrollY: 0, noOverflow: true });
  S('green-narrow-scroll', '{pageScrolled:f.pageScrolled,passed:f.pageScrolled}');
  return steps;
}
