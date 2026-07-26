# Gate 負向測試報告（2026-07-26）

實驗章程：`.scratch/gate-audit/spec.md`。分支 `test/gate-audit`，八項故障注入逐道驗證，
注入物全數還原、零殘留。

## 一句話結論

**四道 gate（tsc／vitest 快照／鏡像 --check／build 後掃 dist）確實有紅燈能力，不是裝飾。**
但金鑰紅線這一條的機械防護**對本專案的真實金鑰無效**——文件版 gate 掃的是 `AIza` 前綴，
而 `.env` 裡的 `GEMINI_API_KEY` 實測長度 53 且**不是** `AIza` 前綴。也就是說：真金鑰若進了
bundle，文件版 gate 會給綠燈。這是本次最高嚴重度發現，已由新腳本 `npm run gate` 補上。

---

## 八項實驗：預期 vs 實際

| # | 實驗 | 預期 | 實際 | 判定 |
|---|---|---|---|---|
| E1 | canary 進活代碼（`services/gemini.ts` 的 `payload.prompt`），build 後掃 `dist/` | 掃到 | 掃到：`dist/assets/index-BFEyn5Vz.js:218` | ✅ 符合 |
| E2 | 同 canary 改放未引用常數（module-local ＋ `export` 但無人 import 兩種） | 掃不到（tree-shaking） | 兩種都掃不到；canary 同時躺在 git 追蹤的 `services/gemini.ts` | ✅ 符合，並實證 git 缺口 |
| E3 | Vite env 內聯行為（三種寫法） | 未知，探索 | 見下方「金鑰進 bundle 的現實路徑」 | ✅ 已測繪 |
| E4 | `api/` 是否在 tsc 範圍：塞型別錯誤 | 若不在範圍→重大缺口 | **在範圍**。`api/gemini.ts(36,7) error TS2322`，exit=2 | ✅ 疑慮證否（好消息） |
| E5 | `tsc --noEmit --strict` 普查 | 只量化 | 24 錯 / 4 檔 | ✅ 已量化 |
| E6 | SI 改一字（長度不變）→ `npm run test` | 快照紅燈 | `FUNDAMENTALS_SYSTEM_INSTRUCTION 逐字未變` mismatched，1 failed / 309 passed；還原後 310 全綠 | ✅ 符合 |
| E7 | 手改鏡像檔 → `sync_skills_mirror.py --check` | 非零 exit ＋ 列出檔案 | exit=1，`內容不一致：trend-analysis/SKILL.md`；`npm run sync:skills` 還原 | ✅ 符合 |
| E8 | 白名單外目錄塞進 `.agents/skills/` | sync 與 `--check` 都不碰、不報 | 兩者皆 exit=0「鏡像一致 ✓」，孤兒 md5 未變 | ✅ 文件宣稱屬實 |

### E3 明細：金鑰進 bundle 的現實路徑

**先做的功課**：`vite.config.ts` **沒有** `define`、**沒有** `envPrefix`、**沒有** `loadEnv`
→ 全走 Vite 預設，即 `envPrefix = 'VITE_'`。

| 路徑 | 進 dist？ | 說明 |
|---|---|---|
| 1. 活代碼直接字面寫死 | **是** | E1 |
| 2. 死代碼（未引用常數／`export` 但無人 import） | 否 | E2；但**進 git** |
| 3. `.env.local` 的 `VITE_*`，程式完全不引用 | 否 | E3a |
| 4. `VITE_*` 被具名引用 `import.meta.env.VITE_FAKE_KEY` | **是** | E3b |
| 5. 整體引用 `import.meta.env`（**沒點名任何變數**） | **是** | E3c——最陰險：不需要有人寫出金鑰名字，全部 `VITE_*` 一起被內聯 |
| 6. 非 `VITE_` 前綴的 `.env` 變數（實測 7 個，含 `GEMINI_API_KEY`／`FINMIND_TOKEN`） | 否 | 即使走路徑 5 也不進——`envPrefix` 預設只曝 `VITE_` |

第 6 條是目前後端金鑰不會進前端 bundle 的**唯一憑藉**，而它是一個沒有任何測試守護的
Vite 預設值（見缺口 G3）。

### E5 明細：`--strict` 欠帳 24 筆

| 檔案 | 筆數 | 主要錯誤碼 |
|---|---|---|
| `api/_lib/llm.ts` | 18 | TS18047（`child.stdin/stdout/stderr` possibly null） |
| `services/yahoo.ts` | 4 | TS2345（`number \| null` → `number \| undefined`） |
| `index.tsx` | 1 | TS7016（`react-dom/client` 缺型別宣告） |
| `components/fundamentals/QuarterlyTrendCharts.tsx` | 1 | TS2322（recharts `LabelFormatter` 不相容） |

全部屬 null-safety／型別宣告類，無語意錯誤。**本次只量化不修**。

### E6 加查：SI 100% 入鎖，prompt 端只有 25%

`services/gemini.ts` 的 5 個 SI 常數與 `utils/geminiRules.test.ts` 的鎖定清單**逐項對得上，5/5**。
但快取鍵是 `fnv1a(systemInstruction + ' ' + prompt)`——prompt 那半邊：

| 呼叫端 | prompt 來源 | 有無位元組鎖 |
|---|---|---|
| `analyzeEntryWithGemini` | 行內 template（`promptData`，L222） | ✗ |
| `analyzeTradeDecision` | 行內 template（`promptText`，L617） | ✗ |
| `analyzePortfolioHealth` | `formatHealthCheckData()` ＋ L960 的 wrapper 前綴 | △ 函式輸出有鎖，wrapper 前綴無鎖 |
| `analyzeFundamentals` | `formatFundamentalsData()`（L976，module-private，**零測試**） | ✗ |

SI 動一字會紅、prompt 動一字不會紅，但兩者讓 A3 分析快取與 Gemini implicit caching
失效的效果**完全相同**（＝使用者突然多付一輪費用）——這正是 `geminiRules.test.ts`
開頭自述要守的東西。

---

## 缺口清單（嚴重度排序）

### G1 — 文件版金鑰掃描對本專案的真實金鑰無效 🔴 最高

`CORE_RULES.md` 寫 `grep -r "AIza" dist/`。實測 `.env`：`GEMINI_API_KEY` 長度 53、
**非** `AIza` 前綴（`FINMIND_TOKEN` 長度 180 亦非）。真金鑰若因路徑 1/4/5 進了 bundle，
文件版 gate **不會紅**。
→ 新腳本規則 (b)：讀 `.env*` 所有長度 >8 的值，對 `dist/` 做**字面比對**，不論形狀。

### G2 — 「或 git」半條零機械防護（E2 實證）🔴

紅線寫「不進前端 bundle **或 git**」，文件版 gate 五道**沒有任何一道讀原始碼**。
E2 證明：金鑰放在未引用的常數 → tree-shaking 移除 → `dist/` 掃描綠燈 → 金鑰安然
躺在 git 追蹤的檔案裡等著被 commit。
→ 新腳本規則 (a2)＋(c)：對 git 追蹤中的原始碼掃金鑰形狀，並用 `.env` 的秘密值做字面比對。

### G3 — 後端金鑰不進 bundle 只靠一個沒人守的 Vite 預設值 🟠

E3 第 6 條成立的唯一理由是 `envPrefix` 預設 `'VITE_'`。任何人在 `vite.config.ts` 加一行
`envPrefix: ''`，或加 `define: { 'process.env': ... }`，**全部** `.env` 變數立刻具備進 bundle
的資格，而且不會有任何測試紅燈。目前零測試守護這個假設。
→ 未修（屬新增測試，超出本次審計範圍）。建議：加一條測試斷言 `vite.config.ts` 未設定
`envPrefix`／`define`，或改為顯式 `envPrefix: 'VITE_'` 並鎖住。

### G4 — 照文件字面把金鑰掃描套到原始碼會「開箱即紅」🟠

`api/_lib/http.ts:108` 的 log 消毒 regex 本身含 `AIza[0-9A-Za-z_-]+`。誰若把
`grep -r "AIza"` 直接套到原始碼，第一次就紅，接著就會學會忽略這道 gate——比沒有 gate 更糟。
→ 新腳本對**原始碼**改用有形狀的比對（前綴 ＋ 30 字以上金鑰字元），實測不會match 該 regex，
對 `dist/` 才保留裸前綴（產物沒有任何正當理由出現這四個字，基線實測乾淨）。

### G5 — tsc 非密閉：型檢把自己的建置產物吸進來 🟠

`tsconfig.json` 沒有 `include`／`exclude`／`files`，走預設 `**/*` ＋ `allowJs: true`
→ 收錄 115 檔（排除 node_modules 後），其中 **8 檔是 `dist/assets/*.js`**。後果：
1. gate 結果取決於 `dist/` 是否存在與內容。文件版順序是 tsc → … → build，
   所以「build 前跑 tsc」與「build 後跑 tsc」檢查的是不同的檔案母體。
2. 白費時間型檢壓縮後的 vendor bundle。
3. 若存在 agent worktree，`.claude/` 下的複本會被同樣吸進來（LESSONS 2026-07-13 已記錄此類污染）。

好消息是 `api/` **確實在範圍內**（12 檔），E4 的疑慮證否——「tsc 0 錯」對後端是有發言權的。
→ 未修（改 `tsconfig.json` 是行為變更，留給使用者拍板：加
`"exclude": ["node_modules", "dist", ".claude"]`）。

### G6 — prompt 端幾乎沒有防漂移鎖 🟡

見上方 E6 加查表。4 個 prompt 建構端只有 1 個（且只有一半）在鎖內；
`formatFundamentalsData` 零測試。
→ 未修（屬新增測試）。

### G7 — package diff 對 staged 變動失明 🟡

`git diff --quiet package.json package-lock.json` 比的是**工作樹 vs index**。
`git add package-lock.json` 之後這道 gate 就綠了。
→ 新腳本保留文件版語意做紅綠判定（否則「刻意改 scripts 但還沒 commit」會被誤判成紅），
但額外印出「相對 HEAD 仍有差異」的提醒，不讓它靜默。

### G8 — 鏡像孤兒完全沒有機械偵測（宣稱屬實，但屬實 ≠ 有防護）🟡

E8 確認 CORE_RULES 敘述正確：白名單外的東西 sync 不碰、`--check` 不報、exit 0。
唯一訊號是 `git status` 的 `??`——一旦有人把孤兒 commit 進去，就**再也沒有任何機械手段
會提到它**，它會是一份永遠不會更新、Codex 卻讀得到的假規則。
→ 未修。建議（低優先）：`--check` 增加「白名單外目錄」警示（不必紅燈，印出即可）。

### G9 — `--strict` 欠帳 24 筆 🟢 純紀錄

見 E5 明細。不影響現行 gate（現行 gate 不開 `--strict`）。

---

## 交付物：`npm run gate`

`scripts/run-gate.mjs`，**零新依賴，只用 node 內建模組**（繞開 PowerShell 5.1 沒有 grep 的問題）。
依序 fail-fast：

```
[1/5] npx tsc --noEmit
[2/5] npm run test
[3/5] npm run build
[4/5] 金鑰掃描（三條規則，見下）
[5/5] git diff --quiet -- package.json package-lock.json
```

任一段失敗 → exit 1，結尾摘要標明是哪一段紅的。fail-fast 的理由：tsc 紅掉時 build 的結果沒有意義。

### 金鑰掃描的三條規則

| 規則 | 掃什麼 | 對象 | 補的是哪個缺口 |
|---|---|---|---|
| (a1) | Google 金鑰裸前綴 | `dist/` | 文件版原有能力 |
| (a2) | 前綴 ＋ 30 字以上金鑰字元（有形狀） | git 追蹤中的原始碼（排除 `*.md`） | G2、G4 |
| (b) | `.env*` 所有長度 >8 的值，字面比對 | `dist/` | G1（任何形狀的秘密） |
| (c) | `.env*` 中**秘密名**（`KEY`／`TOKEN`／`SECRET`／`PASSWORD`／`_PAT` 結尾）的值，字面比對 | git 追蹤中的原始碼 | G2 |

- 秘密值**永不進終端**：只印變數名、命中檔案、遮罩預覽（前 4 碼 ＋ 長度）。
- `*.md` 排除：規則文件本身就含 `AIza` 字樣做說明（實測 68 個追蹤中的 `.md` 命中）。
- (c) 限定「秘密名」是為了避開 `GEMINI_MODEL_FAST`、`LLM_PROVIDER` 這類設定值必然
  出現在原始碼裡造成的誤報；(b) 對 `dist/` 不限名（實測 7 個值全部不在 dist，零誤報）。
- 範本檔（`.env.example`／`.sample`／`.template`）在 (b)(c) 中跳過：裡面是佔位符，
  比對只會製造誤報。它仍受 (a2) 覆蓋（是 git 追蹤中的非 `.md` 檔）。
- 無 `.env*` 可讀時 (b)(c) 整條略過，不影響 (a)。

### 偏離章程之處（請覆核）

1. **章程只要求 (b) 對 `dist/` 比對；本腳本額外加了 (c) 對 git 追蹤原始碼比對。**
   理由：章程自己的動機段寫「git 半條零機械防護」，而 (a2)＋(c) 才是真正把那半條補起來
   的東西。若覺得多餘可刪 (c)，(a2) 仍會擋住 Google 形狀的金鑰。
2. **原始碼掃描用有形狀的比對，而非章程字面的 `AIza` 前綴。** 理由見 G4——用裸字面會
   開箱即紅。`dist/` 仍用裸前綴。
3. **第 5 段用工作樹 vs index（文件版語意），另印相對 HEAD 的提醒。** 理由見 G7。

### 紅燈自證

新腳本自己也做過負向測試（一次注入同時觸發三條規則）：

```
=== [4/5] 金鑰掃描 ===
  ✗ 掃到 3 筆：
      (a) services/gemini.ts:20 原始碼含 Google 金鑰形狀字串
      (b) .env.local 的 GATE_AUDIT_FAKE_TOKEN sk_F…(len=42) 出現在建置產物 dist/assets/index-BoqW1yml.js
      (c) .env.local 的 GATE_AUDIT_FAKE_TOKEN sk_F…(len=42) 出現在 git 追蹤檔 services/gemini.ts

✗ GATE 紅燈：金鑰掃描 段未通過（後續段落未執行）
```

其中 (a) 命中的是**死代碼** canary（`dist/` 掃不到它）——正是 G2 的缺口；
(b) 命中的是**非 `AIza` 形狀**的秘密——正是 G1 的缺口。
第 1、2 段的紅燈能力由 E4、E6 各自獨立驗過（腳本只是轉呼同一條指令）。

---

## 隔離協議執行紀錄

- 全程在 `test/gate-audit`；每項實驗結束立即 `git checkout --` 還原並驗 `git status` 乾淨。
- canary 一律 `AIza` ＋ `FAKE_CANARY` ＋ 39 字元（貼近真金鑰長度）。
- `.env` 既有內容全程未動；探針只走 `.env.local`（`.gitignore` 已涵蓋 `.env.*` 與 `*.local`），
  用完刪除。真金鑰全程未印出終端——查核 `AIza` 前綴時只輸出布林值與長度。
- 實驗期間未起 dev server（LESSONS 2026-07-06：檔案監看會鎖 git）。
- 文字掃描全部用 Bash 工具（PowerShell 5.1 沒有 grep）。
