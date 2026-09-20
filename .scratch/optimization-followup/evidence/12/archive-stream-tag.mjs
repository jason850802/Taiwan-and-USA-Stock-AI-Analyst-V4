// 只封存本次串流標記診斷的明確檔案；不移動快取profile／App或其他票的原始證據。
import { readFileSync, mkdirSync, renameSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir=fileURLToPath(new URL('./',import.meta.url)),target=path.join(dir,'precheck-stream-tag');
if(existsSync(target))throw Error('診斷目錄已存在，不覆寫');
const summary=JSON.parse(readFileSync(path.join(dir,'stream-summary.json'),'utf8'));
const names=[...summary.checked.map(row=>row.file),'stream-summary.json','stream-startup.json','stream-ui-desktop','stream-ui-narrow','app-healthguard-narrow-0.json','cleanup-stream.json'];
if(new Set(names).size!==names.length)throw Error('重複封存路徑');
for(const name of names){if(name.includes('/')||name.includes('\\')||!existsSync(path.join(dir,name)))throw Error(`非預期檔名：${name}`);}
mkdirSync(target);
for(const name of ['health-app.js','stream-server.mjs','stream-layout.mjs','verify-stream-ui.mjs'])copyFileSync(path.join(dir,name),path.join(target,name));
for(const name of names)renameSync(path.join(dir,name),path.join(target,name));
writeFileSync(path.join(target,'README.md'),'# 串流正式表單標記診斷\n\n09假站只保留tag的A-Z／0-9／連字號。12健康回歸使用BATCH_OLD、HEALTH_NEW，HTTP回應實際變成BATCHOLD、HEALTHNEW，造成等待錯誤名稱逾時。真實表單已取得新ID／USD成本200，舊批次沒有回填，新單檔串流也已完成，失敗位於驗收腳本的名稱斷言。\n\n修正12測試標記為BATCH-OLD／HEALTH-NEW，保留實際移除、新成本、新請求及全文斷言，不改產品。這裡保存修正前工具及同次runId的原始資料；因工具指紋改變，整個串流組另作完整新run，不混入最終通過。\n','utf8');
console.log(JSON.stringify({archived:names.length,destination:'precheck-stream-tag'}));
