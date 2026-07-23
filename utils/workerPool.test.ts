// utils/workerPool.test.ts — Phase 12 T4：併發游標池的行為鎖
//
// 這支取代了原本手刻三份的游標池（回推抓價、配息查詢、批次健檢）。
// 併發上限用「同時在飛計數器」斷言，不用時序猜測——時序測試在 CI 上必然不穩。
import { describe, it, expect, vi } from 'vitest';
import { runWithConcurrency } from './workerPool';

/** 可控制解析時機的 deferred，用來把多個 task 卡在「在飛」狀態 */
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const tick = () => new Promise(r => setTimeout(r, 0));

describe('runWithConcurrency', () => {
  it('每個項目都被處理一次（完成順序無關）', async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n); });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('同時在飛數量不超過 workers', async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
    });
    expect(peak).toBe(3);
  });

  it('workers 多於項目數時不會多起 worker', async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency([1, 2], 10, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
    });
    expect(peak).toBe(2);
  });

  it('某個項目拋錯不會中斷整池，其餘照跑完', async () => {
    const done: number[] = [];
    await runWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      done.push(n);
    });
    expect(done.sort((a, b) => a - b)).toEqual([1, 3, 4]);
  });

  it('onSettled：成功帶 value、失敗帶 error', async () => {
    const settled: string[] = [];
    await runWithConcurrency(['ok', 'bad'], 1, async (s) => {
      if (s === 'bad') throw new Error('nope');
      return s.toUpperCase();
    }, {
      onSettled: (item, r) => {
        settled.push(r.ok ? `${item}=${r.value}` : `${item}!${(r.error as Error).message}`);
      },
    });
    expect(settled).toEqual(['ok=OK', 'bad!nope']);
  });

  it('空陣列直接完成，task 一次都不呼叫', async () => {
    const task = vi.fn();
    await runWithConcurrency([], 3, task);
    expect(task).not.toHaveBeenCalled();
  });

  it('全部項目結束前不會 resolve', async () => {
    const d = deferred<void>();
    let finished = false;
    const run = runWithConcurrency([1, 2], 2, async (n) => {
      if (n === 2) await d.promise;
    }).then(() => { finished = true; });

    await tick();
    expect(finished).toBe(false);   // 還卡著一個項目
    d.resolve();
    await run;
    expect(finished).toBe(true);
  });
});
