// utils/workerPool.ts — 併發游標池唯一實作（Phase 12 T4）
//
// 取代原本手刻的三份同構游標池：回推抓價（PnlHistorySection）、配息查詢（同檔）、
// 批次健檢（Portfolio）。三份的語意本來就一樣——共享 index 游標、worker 數以
// Math.min 夾住項目數、單一項目失敗不得中斷整池——差別只在「失敗與進度怎麼記」，
// 那部分由 hooks 交還給呼叫端。
//
// 行為鎖：utils/workerPool.test.ts（併發上限以「同時在飛」計數器斷言，不用時序猜測）。

/**
 * 單一項目的結果。兩個分支都把對方的欄位列為 optional undefined——
 * 本專案 tsconfig 非 strict，少了這層聯合型別窄化不會生效，呼叫端讀 .error 會編譯失敗。
 */
export type WorkerPoolResult<R> =
  | { ok: true; value: R; error?: undefined }
  | { ok: false; value?: undefined; error: unknown };

export interface WorkerPoolHooks<T, R> {
  /** 每個項目結束時呼叫（成功或失敗都會）——進度回報與失敗收集都在這裡做 */
  onSettled?: (item: T, result: WorkerPoolResult<R>) => void;
}

/**
 * 以 workers 條並行線消化 items，全部結束才 resolve。
 * 單一項目拋錯不會中斷其他項目（錯誤交給 hooks.onSettled，不往外拋）。
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  workers: number,
  task: (item: T) => Promise<R>,
  hooks?: WorkerPoolHooks<T, R>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        try {
          const value = await task(item);
          hooks?.onSettled?.(item, { ok: true, value });
        } catch (error) {
          hooks?.onSettled?.(item, { ok: false, error });
        }
      }
    }),
  );
}
