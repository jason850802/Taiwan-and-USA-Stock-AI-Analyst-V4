import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const directory = [{ id: '2330', name: '台積電', market: 'TW', type: 'twse' }];
const remote = { ok: true, json: async () => ({ quotes: [{ symbol: 'AAPL', shortname: 'Apple', quoteType: 'EQUITY', exchange: 'NMS' }] }) };

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === 'tw_stock_directory_v1' ? JSON.stringify(directory) : String(Date.now()),
    setItem: () => {},
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('股票搜尋載入', () => {
  it('冷啟動並行查詢海外與名錄，不必串行等待名錄', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    let finishDirectory: (value: unknown) => void;
    const fetchMock = vi.fn(async input => String(input).includes('/api/finmind')
      ? new Promise(resolve => { finishDirectory = resolve; }) : remote);
    vi.stubGlobal('fetch', fetchMock);
    const { searchStocks } = await import('./stockDirectory');
    const onResults = vi.fn();
    const pending = searchStocks('AAPL', onResults);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onResults).not.toHaveBeenCalled();
    finishDirectory!({ ok: true, json: async () => ({ msg: 'success', data: [{ stock_id: '2330', stock_name: '台積電', type: 'twse' }] }) });
    await pending;
    expect(onResults).toHaveBeenCalledTimes(1);
    expect(onResults.mock.calls[0][0][0].id).toBe('AAPL');
    expect(onResults.mock.calls[0][1]).toBe('final');
  });

  it('中文搜尋不發海外請求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { searchStocks } = await import('./stockDirectory');
    const onResults = vi.fn();
    await searchStocks('台積', onResults);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onResults).toHaveBeenCalledWith(directory, 'final');
  });

  it('本地先上屏，海外同檔股票去重後只發一次 final', async () => {
    let finishRemote: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finishRemote = resolve; })));
    const { searchStocks } = await import('./stockDirectory');
    const onResults = vi.fn();
    const pending = searchStocks('2330', onResults);
    await Promise.resolve();
    expect(onResults).toHaveBeenCalledWith(directory, 'local');
    finishRemote!({ ok: true, json: async () => ({ quotes: [{ symbol: '2330.TW', quoteType: 'EQUITY' }] }) });
    await pending;
    expect(onResults.mock.calls).toEqual([[directory, 'local'], [directory, 'final']]);
  });

  it('取消後即使伺服器仍回傳舊結果也不通知畫面', async () => {
    let finishRemote: (value: unknown) => void;
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise(resolve => { finishRemote = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const { searchStocks } = await import('./stockDirectory');
    const onResults = vi.fn();
    const controller = new AbortController();
    const pending = searchStocks('AAPL', onResults, controller.signal);
    await Promise.resolve();
    controller.abort();
    finishRemote!(remote);
    await pending;
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    expect(onResults).not.toHaveBeenCalled();
  });

  it('已取消或空白查詢不發任何請求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { searchStocks } = await import('./stockDirectory');
    const onResults = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await searchStocks('AAPL', onResults, controller.signal);
    await searchStocks(' ', onResults);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onResults).not.toHaveBeenCalled();
  });

  it('海外失敗仍回傳本地 final 讓載入狀態結束', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('模擬離線')));
    const { searchStocks } = await import('./stockDirectory');
    const onResults = vi.fn();
    await searchStocks('2330', onResults);
    expect(onResults.mock.calls).toEqual([[directory, 'local'], [directory, 'final']]);
  });
});
