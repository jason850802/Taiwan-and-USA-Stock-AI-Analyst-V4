# 01 — React DOM 入口補正式型別依賴（TS7016）

Status: ready-for-agent
Blocked by: —（依 spec 順序第一票）

## What to build

消掉 React 入口檔對 `react-dom/client` 的 TS7016（缺 declaration file）：安裝
`@types/react-dom`（devDependencies，主版本對齊專案的 react-dom ^19）。這是
授權書第 1 條的一次性紅線解除，允許的 diff 範圍以授權書為準——`package.json`
一行＋lockfile 僅該套件及其自身依賴的條目。

順帶查核（登記不修）：專案的 `@types/react` 疑似只靠傳遞依賴存在（`package.json`
未列、`node_modules/@types/react` 卻在）——若屬實，整個 TSX 型檢都押在一個
上游套件的間接依賴上，依賴更新即可能無聲消失。登記進 findings 交裁決，
**不要**未授權順手安裝。

## 驗收條件

- [ ] `npx.cmd tsc --noEmit --strict --pretty false`：TS7016 歸零，strict 總數 5 → 4
- [ ] 裝完套件後無**新增**診斷；若冒出非 React 入口局部的新 strict 錯 → 停損回報，不硬修
- [ ] `npx.cmd tsc --noEmit` exit 0
- [ ] `package.json`／lockfile 變動不超出授權範圍（自查 `git diff` 逐項對照）
- [ ] 既有 666 案全綠、零修改
- [ ] `npm run gate` 全綠（套件變動入 commit 後跑）
- [ ] `@types/react` 傳遞依賴問題已登記 findings（若查證屬實）
