---
phase: quick-260715-jfp
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [.claude/skills/entry-decision/SKILL.md, .agents/skills/entry-decision/SKILL.md, utils/entryFilter.ts]
autonomous: true
requirements: [QT-jfp-SKILL-FILTER-ALIGN]
---

<objective>
`.claude/skills/entry-decision/SKILL.md`（AI 分析的進場篩選 skill）與 `utils/entryFilter.ts`（前端實際執行的濾網程式）已經走鐘：文件說濾網只偵測買點 1、2，但程式早已實作買點 3（K線橫盤突破）；SOP②⑥的文字條件與程式實判不符；鐵則沒寫出 WAIT/NO-GO 分界；信心評分公式描述錯誤；戒律哪些由濾網量化、哪些靠 AI 判讀沒有註記。

本任務把文件對齊到程式碼現況（docs ← code），外加一處 `entryFilter.ts` 的 SOP② label 顯示字串修正（label 寫兩線、實判三線）。**嚴禁改動任何判定邏輯／行為**——`utils/entryFilter.test.ts` 是 32 案例行為鎖，改前改後都必須全綠。已確認測試檔沒有斷言 SOP label 字串，label 修改安全。
</objective>

<task id="1" name="修 entryFilter.ts SOP② label 字串">
**前置（CLAUDE.md 規定）：** 動 `utils/entryFilter.ts` 前先跑 `npm run test`，確認 32 案例基線全綠。

**編輯 `utils/entryFilter.ts`（約 line 308），唯一一處修改：**

old:
```
    { label: '②均線：MA10/MA20多排向上', ok: align3Long && maUp },
```
new:
```
    { label: '②均線：MA5/MA10/MA20三線多排向上', ok: align3Long && maUp },
```

判定條件 `align3Long && maUp` 一字不動。

**驗證後提交：** `npm run test` 全綠＋`npx tsc --noEmit` 無錯誤，才 commit。
Commit（只 stage 這一檔，不得夾帶工作區既有的 .planning 修改）：
`fix(entryFilter): SOP② label 補上 MA5——實判三線多排，label 原只寫兩線`
</task>

<task id="2" name="對齊 entry-decision SKILL.md 至濾網現況＋同步 Codex 鏡像">
**編輯 `.claude/skills/entry-decision/SKILL.md`，共 6 處（old 字串以現檔為準，逐條 Edit）：**

(a) SOP②（line 14）——濾網實判三線多排：
old: `2. 均線：MA10、MA20 多頭排列、方向向上。（步驟4）`
new: `2. 均線：MA5＞MA10＞MA20 三線多排、方向向上（濾網以三線多排實判，較講義的兩線更嚴）。（步驟4）`

(b) SOP⑥（line 18）——濾網不要求當日黃金交叉、且有高檔鈍化替代路徑：
old: `6. 指標：MACD 綠柱縮短/紅柱延長，KD 黃金交叉向上多排。（步驟6）`
new: `6. 指標：KD 多排向上（K＞D，不要求當日黃金交叉）＋MACD 柱轉強（紅柱延長/綠柱縮短）；KD 高檔鈍化（K、D 皆>80）時回歸價量，價漲＋攻擊量視同通過。（步驟6）`

(c) B 段開頭註記（line 21）——濾網已偵測買點 3：
old: `> 濾網程式目前偵測 1、2；3~6 為 **AI 判讀項**（濾網暫不偵測，由分析時人工／AI 對照K線判定）。`
new: `> 濾網程式偵測 1、2、3（判定優先序 3→2→1，結構最特定者先判）；4~6 為 **AI 判讀項**（濾網不偵測，由分析時人工／AI 對照K線判定）。`

(d) B 段買點 3（line 24）——改標「濾網偵測」並寫出濾網實際條件：
old: `3. **K線橫盤突破**（AI判讀）：上漲中連三天以上收盤未過第一根K最高點、也未破其最低點＝K線橫盤；大量中長紅K收盤突破該高點＋MA20向上＋KD多排＝買點。`
new: `3. **K線橫盤突破**（濾網偵測）：上漲中連 3 根以上收盤未過起始K最高點、也未破其最低點＝K線橫盤（濾網最多回看 12 根）；今日中長紅（漲>2%）帶攻擊量收盤突破該高點、且 MA20 未下彎＝買點。`

(e) C 段末尾（line 33 之後、`## D.` 之前）新增一行量化範圍註記：
```
> 濾網量化檢核：戒律 1（未站上月線）、2（連漲≥3根）、3（距週線壓力<5%）、6（盤整）、7（週空日多）、9（價漲黑K）；戒律 5 濾網僅在步驟2以警示呈現，不計入否決與扣分；戒律 4、8、10 為 AI 判讀項。
```

(f) 最終輸出格式兩處：
- line 57 的 `（3~6 為AI判讀項）` → `（4~6 為AI判讀項）`
- line 61：
  old: `信心評分：<0-100>（6步驟通過數 + 戒律 + 口訣）`
  new: `信心評分：<0-100>（SOP通過數/6×80 為基底；符合口訣+10；每觸犯一戒律−8；NO-GO 上限30）`

(g) 鐵則第一條（line 86）——寫出 NO-GO 與 WAIT 的分界（對齊 entryFilter.ts 決策邏輯）：
old: `- SOP 6 項只要有 1 項不過，或觸犯任一戒律，或趨勢非多頭 → **不得給 GO**，最高給「等待」。`
new:
```
- **NO-GO 門檻**：日線趨勢非多頭，或收盤未站上月線 MA20 → 直接 NO-GO。
- **GO 四要件**：趨勢多頭站上月線＋SOP 6 項全過＋無觸犯戒律＋進場口訣至少符合一式；缺任一（且未達 NO-GO 門檻）→ 最高給「等待」。
```

**同步鏡像（CLAUDE.md 規定）：** 改完 `.claude/skills/` 後執行 `npm run sync:skills`，確認 `.agents/skills/entry-decision/SKILL.md` 已同步更新。

**提交：** stage `.claude/skills/entry-decision/SKILL.md` 與 `.agents/skills/entry-decision/SKILL.md` 兩檔（同樣不得夾帶其他工作區修改）：
`docs(skill): entry-decision SKILL.md 對齊 entryFilter.ts 現況（買點3已由濾網偵測、SOP②⑥、鐵則分界、信心公式、戒律量化註記）`
</task>

<verify>
- `npm run test`：任務前後皆 32 案例全綠（行為鎖未動）。
- `npx tsc --noEmit`：無錯誤。
- `git diff HEAD~2 -- utils/entryFilter.ts` 只有 label 字串一行差異。
- `.claude/skills/entry-decision/SKILL.md` 與 `.agents/skills/entry-decision/SKILL.md` 內容一致。
- 兩個 commit 都沒有夾帶 `.planning/` 下既有的未提交修改。
</verify>

<done>
SKILL.md 所述的濾網能力（買點偵測範圍、SOP 條件、決策分界、信心公式、戒律量化範圍）與 entryFilter.ts 實際行為一一對應；AI 依 skill 分析時不會再把濾網已自動偵測的「K線橫盤突破」當成人工判讀項，UI 上 SOP② label 也如實反映三線多排的實判條件。判定行為零變更。
</done>
