// 只觀察公開提交回呼與瀏覽器動畫影格邊界，不鎖內部變數或React狀態。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFramePublisher } from './framePublisher';

describe('累積報告的畫面提交', () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let nextId: number;
  beforeEach(() => {
    callbacks = new Map(); nextId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++nextId, callback); return nextId; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  });
  afterEach(() => vi.unstubAllGlobals());
  const frame = () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(100)); };

  it('同一影格的多個累積片段只提交最新全文', () => {
    const publish = vi.fn();
    const report = createFramePublisher(publish);
    report.push('甲'); report.push('甲乙'); report.push('甲乙丙');
    expect(publish).not.toHaveBeenCalled();
    frame();
    expect(publish.mock.calls).toEqual([['甲乙丙']]);
  });

  it('完成立即提交最終全文，暫停影格也不會遺漏尾段或重複提交', () => {
    const publish = vi.fn();
    const report = createFramePublisher(publish);
    report.push('甲');
    report.finish('甲乙');
    expect(publish.mock.calls).toEqual([['甲乙']]);
    frame(); report.push('舊段'); report.finish('重複完成');
    expect(publish.mock.calls).toEqual([['甲乙']]);
  });

  it('取消後晚到的片段與完成都不能復活畫面工作', () => {
    const publish = vi.fn();
    const report = createFramePublisher(publish);
    report.push('舊報告'); report.cancel(); frame();
    report.push('晚段'); report.finish('晚完成'); frame();
    expect(publish).not.toHaveBeenCalled();
  });

  it('慢片段每個影格仍可顯示，後續保留完整累積文字', () => {
    const publish = vi.fn();
    const report = createFramePublisher(publish);
    report.push('甲'); frame(); report.push('甲乙'); frame(); report.finish('甲乙丙');
    expect(publish.mock.calls).toEqual([['甲'], ['甲乙'], ['甲乙丙']]);
  });

  it('空報告及單片段完成不需先排入動畫影格', () => {
    const publish = vi.fn();
    createFramePublisher(publish).finish('');
    createFramePublisher(publish).finish('只有一段');
    expect(publish.mock.calls).toEqual([[''], ['只有一段']]);
  });

  it('不同報告的取消與完成互不影響', () => {
    const first = vi.fn(), second = vi.fn();
    const a = createFramePublisher(first), b = createFramePublisher(second);
    a.push('舊'); b.push('新'); a.cancel(); frame(); b.finish('新全文');
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([['新'], ['新全文']]);
  });
});
