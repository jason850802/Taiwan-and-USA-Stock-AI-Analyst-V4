// utils/portfolioItemsStore.ts — 庫存持股本體（2026-07-27 自 App.tsx 收編）
//
// 為什麼抽出來：六把 localStorage key 裡它原本是唯一就地建在 App.tsx 的，
// 測試碰不到真 store——key 打錯一個字或 decode 收緊，331 測試照樣全綠。
// 更危險的是 App 的寫入 effect 首次 render 後必跑一次：load() 一旦退回 fallback，
// 空陣列下一拍就被寫回去，**持股不是讀不到，是被覆寫成沒了**。
// 抽成模組讓 utils/persistentStore.test.ts 能用真實舊格式 fixture 鎖住它。
//
// 位元組相容鐵則：儲存形狀是**裸陣列**（六把中唯一無信封者），不加信封、不做遷移。
// 缺 exchangeRate/buyDate 的舊資料是合法狀態（types.ts：undefined＝舊資料），不得拒收。
import { PortfolioItem } from '../types';
import { createPersistentStore } from './persistentStore';

const KEY = 'portfolio_items';

// 裁剪策略維持「無」——持股是本體，寧可寫不進去也不砍。
const store = createPersistentStore<PortfolioItem[]>({
  key: KEY,
  fallback: () => [],
  decode: (raw) => (Array.isArray(raw) ? (raw as PortfolioItem[]) : null),
});

export const loadPortfolioItems = (): PortfolioItem[] => store.load();

export const savePortfolioItems = (items: PortfolioItem[]): boolean => {
  const ok = store.save(items);
  if (!ok) console.warn('[portfolioItemsStore] 庫存寫入失敗（storage 滿或不可用）');
  return ok;
};
