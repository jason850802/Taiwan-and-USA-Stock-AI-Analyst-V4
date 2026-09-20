// 公開排程邊界：以真正執行中的假任務量峰值，不讀內部佇列或計數器。
import { describe, expect, it } from 'vitest';
import { createHoldingPriceQueue } from './holdingPriceQueue';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};

describe('庫存排程的共用控制範圍', () => {
  it('重疊批次共用三個執行槽，所有最後意圖皆能完成', async () => {
    const queue = createHoldingPriceQueue();
    const waiting: (() => void)[] = [];
    const completed: string[] = [];
    let active = 0, peak = 0;
    const add = (id: string, generation: number) => queue.enqueue(id, async () => {
      active++; peak = Math.max(peak, active);
      await new Promise<void>(resolve => waiting.push(resolve));
      completed.push(`${id}:${generation}`); active--;
    });
    const first = Array.from({ length: 30 }, (_, i) => add(`stock-${i}`, 0));
    await flush();
    expect(active).toBe(3);
    const superseded = Array.from({ length: 30 }, (_, i) => add(`stock-${i}`, 1));
    const latest = Array.from({ length: 30 }, (_, i) => add(`stock-${i}`, 2));
    for (let i = 0; i < 15; i++) { waiting.splice(0).forEach(resolve => resolve()); await flush(); }
    await Promise.all([...first, ...superseded, ...latest]);
    expect(peak).toBe(3);
    expect(completed.filter(id => id.endsWith(':2'))).toHaveLength(30);
    expect(completed.some(id => id.endsWith(':1'))).toBe(false);
    expect(active).toBe(0);
  });

  it('匯率在首批即取得機會，不被整串股票排在後面', async () => {
    const queue = createHoldingPriceQueue();
    const gate = deferred();
    const started: string[] = [];
    const stock = Array.from({ length: 30 }, (_, i) => queue.enqueue(`s${i}`, async () => { started.push(`s${i}`); await gate.promise; }));
    const fx = queue.enqueue('fx', async () => { started.push('fx'); await gate.promise; }, true);
    await flush();
    expect(started).toEqual(['fx', 's0', 's1']);
    gate.resolve(); await Promise.all([...stock, fx]);
  });

  it('替換尚未開始的工作會結束舊等待者，只執行最後內容', async () => {
    const queue = createHoldingPriceQueue();
    const seen: string[] = [];
    let oldSettled = false;
    const old = queue.enqueue('A', async () => { seen.push('old'); }).then(() => { oldSettled = true; });
    const latest = queue.enqueue('A', async () => { seen.push('new'); });
    await Promise.all([old, latest]);
    expect(oldSettled).toBe(true);
    expect(seen).toEqual(['new']);
  });

  it('取消與清空不啟動排隊工作，等待者皆正常結束', async () => {
    const queue = createHoldingPriceQueue();
    const gate = deferred();
    const active = ['a', 'b', 'c'].map(key => queue.enqueue(key, () => gate.promise));
    await flush();
    const seen: string[] = [];
    const removed = queue.enqueue('removed', async () => { seen.push('removed'); });
    const cleared = queue.enqueue('cleared', async () => { seen.push('cleared'); });
    queue.cancel('removed'); queue.clear();
    await Promise.all([removed, cleared]);
    gate.resolve(); await Promise.all(active);
    expect(seen).toEqual([]);
    await queue.enqueue('new-mount', async () => { seen.push('new-mount'); });
    expect(seen).toEqual(['new-mount']);
  });

  it('單一失敗釋放槽位，其餘工作繼續並傳遞原錯誤', async () => {
    const queue = createHoldingPriceQueue();
    const error = new Error('合成故障');
    const failed = queue.enqueue('bad', async () => { throw error; }).catch(e => e);
    const seen: number[] = [];
    await Promise.all(Array.from({ length: 10 }, (_, i) => queue.enqueue(`s${i}`, async () => { seen.push(i); })));
    expect(await failed).toBe(error);
    expect(seen).toHaveLength(10);
  });

  it('一筆很慢也不會讓已空出的槽位閒置', async () => {
    const queue = createHoldingPriceQueue();
    const gate = deferred();
    const slow = queue.enqueue('slow', () => gate.promise);
    await flush();
    let completed = false;
    const fast = queue.enqueue('late', async () => { completed = true; });
    await fast;
    expect(completed).toBe(true);
    gate.resolve(); await slow;
  });
});
