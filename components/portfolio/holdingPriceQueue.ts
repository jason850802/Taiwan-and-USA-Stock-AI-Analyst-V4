// 單一庫存 hook 的動態佇列；重疊刷新共用槽位，沿用既有 worker pool 執行批次。
import { runWithConcurrency } from '../../utils/workerPool';

interface HoldingPriceJob {
  task: () => Promise<void>;
  priority: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export const createHoldingPriceQueue = () => {
  const queued = new Map<string, HoldingPriceJob>();
  let active = 0;
  let scheduled = false;

  const pump = () => {
    const batch: HoldingPriceJob[] = [];
    while (active + batch.length < 3 && queued.size > 0) {
      const entry = [...queued].find(([, job]) => job.priority) ?? queued.entries().next().value!;
      queued.delete(entry[0]);
      batch.push(entry[1]);
    }
    active += batch.length;
    void runWithConcurrency(batch, batch.length, async job => {
      try { await job.task(); job.resolve(); }
      catch (error) { job.reject(error); }
      finally { active--; pump(); }
    });
  };
  const cancel = (key: string) => {
    const old = queued.get(key);
    if (old) { queued.delete(key); old.resolve(); }
  };
  return {
    enqueue(key: string, task: () => Promise<void>, priority = false): Promise<void> {
      // 只合併尚未開始的意圖；已開始者仍占槽至真正完成，由 hook 身分守衛丟棄過期結果。
      cancel(key);
      const result = new Promise<void>((resolve, reject) => queued.set(key, { task, priority, resolve, reject }));
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => { scheduled = false; pump(); });
      }
      return result;
    },
    cancel,
    clear() { for (const key of queued.keys()) cancel(key); },
  };
};
