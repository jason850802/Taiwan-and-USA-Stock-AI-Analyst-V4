const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const plan = path.join(root, '.scratch/performance-optimization-20260923');
const entries = [
  { file: path.join(plan, 'issues/03-daily-dev-entry.md'), text: '\n\n## 2026-10-01 精確本機 main 整合完成\n\n依使用者後續明確授權，main 已從 bf7599c 精確整合至 **1a9269fe781f4ae5e0d432d1c22b4c77d6cc3bcd**，47 檔；原工作區與無關修改保留。正式驗收候選49654f3與合併樹完全相同，30檔工具／說明 exact。53檔／838案gate、原埠life8/8、App接受28/28（凍結步驟22/28、終態20/28）、terminal/B1 3/3、五API取消＋guard取消5/5、假守衛37＋13及獨立兩軸覆核通過。清理失敗身分保留、中途／第一輪新增身分、看門失敗狀態及歷史工具依賴說明已處置，舊FAIL與raw不覆寫。完整逐條處置、固定點、界線與九欄交接見 [main整合交付](../evidence/03/MAIN-INTEGRATION-20261001-r1.md)。**03維持resolved，04未領取／執行；production暫不新增，無push／部署／發版。**\n' },
  { file: path.join(plan, 'evidence/03/REVIEW-20260925.md'), text: '\n\n## 2026-10-01 精確 main 整合增補（不改既有覆核）\n\n使用者已授權本機main精確整合、production暫不新增。本機main固定1a9269fe781f4ae5e0d432d1c22b4c77d6cc3bcd（基底bf7599c；受驗候選49654f3），47檔限定範圍、合併樹等於受驗樹、30工具／說明exact；原無關工作檔無漂移。新增清理失敗／身分遺失與歷史依賴發現均已修／明列界線，兩名獨立覆核者確認剩餘finding 0。本輪新原埠life8、App28、terminal3、API取消5＋guard5及gate838通過；原始隔離環境FAIL與raw保留。逐條表、run-id、證據索引、凍結22／終態20及固定九欄交接見 [MAIN-INTEGRATION-20261001-r1.md](MAIN-INTEGRATION-20261001-r1.md)。03維持resolved；未執行04、push、部署或發版。\n' },
];
const receipts = [];
for (const entry of entries) {
  // 只新增本輪字串，既有檔案內容保持原位元組。
  const before = fs.readFileSync(entry.file);
  if (before.includes(Buffer.from(entry.text.trim()))) throw new Error('本增補已存在，拒絕重複');
  fs.appendFileSync(entry.file, entry.text, 'utf8');
  const after = fs.readFileSync(entry.file);
  if (!after.subarray(0, before.length).equals(before)) throw new Error('歷史位元組被改動');
  receipts.push({ path: path.relative(root, entry.file).replaceAll('\\', '/'), beforeBytes: before.length,
    prefixUnchanged: true, beforeSha256: crypto.createHash('sha256').update(before).digest('hex'),
    afterSha256: crypto.createHash('sha256').update(after).digest('hex') });
}
fs.writeFileSync(path.join(__dirname, 'backfill-receipt.json'), JSON.stringify(receipts, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ appended: receipts.length, originalPrefixesUnchanged: true }));
