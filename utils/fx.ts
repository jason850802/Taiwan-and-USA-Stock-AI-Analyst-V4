// utils/fx.ts — 匯率常數（Phase 12 T6a）
//
// USD/TWD 的顯示用後備匯率。**只准表格顯示與表單試算用**——持久化快照（computeLiveSnapshot）
// 與歷史回推（backfillPipeline）拿不到匯率時一律跳過或擋下，不得用這個數字造史料（D-10）。
// 現況散寫在 Portfolio.tsx 的兩處硬編 32 收斂到這裡（T6a 先收主元件，表格那份 T6b 併表時收）。
export const USD_TWD_FALLBACK = 32;
