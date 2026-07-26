// utils/geminiCache.test.ts — Gemini 透明快取 key 的引擎世代段行為鎖
//
// 為什麼需要引擎段：實際型號由**後端** env 決定（`api/_lib/config.ts` 的 GEMINI_MODEL_FAST／
// GEMINI_MODEL_THINKING；`LLM_PROVIDER=claude-cli` 時更是整個換成 Claude），而前端拿不到、
// 也不准內含型號字串（CORE_RULES 紅線）。原本的 key 只有 mode｜日期｜輸入 hash——換了型號
// 之後同一天的舊模型結果會繼續被端出來，使用者看到的分析不是他以為的那顆模型產的。
// 折衷是一個**不含型號名的世代代號** ENGINE_TAG：換型號／換 provider 時手動 bump 一格，
// 全體使用者的舊模型快取當場失效。
//
// 本檔鎖三件事：
//  1. 引擎段的**位置**（prefix 之後、mode 之前）——位置決定跨日清理去讀第幾段，
//     錯位就變成「日期段永遠對不上今天」或「永遠等於今天」，快取不是天天全清就是永遠不清。
//  2. ENGINE_TAG **不得為空、不得含 `|`**——bump 的人塞了分隔符就會讓上面那個段位錯亂。
//  3. 舊 4 段格式的殘留條目會在下一次寫入時被清掉，不留讀不到又佔 quota 的孤兒。
//
// 測試檔放 utils/ 是沿用現行 vitest 收錄範圍（現況測試全在 utils/）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildCacheKey,
  readCache,
  writeCache,
  taipeiTodayStr,
  CACHE_PREFIX,
  ENGINE_TAG,
} from '../services/_shared/geminiCache';

describe('buildCacheKey — 引擎世代段', () => {
  it('引擎段緊接在 prefix 之後、mode 之前', () => {
    const key = buildCacheKey('fast', '2026-07-27', 'SI', 'PROMPT');
    expect(key.startsWith(`${CACHE_PREFIX}${ENGINE_TAG}|fast|2026-07-27|`)).toBe(true);
  });

  it('段位固定：[1]=引擎、[2]=mode、[3]=日期（跨日清理讀的就是 [3]）', () => {
    const segments = buildCacheKey('thinking', '2026-07-27', 'SI', 'PROMPT').split('|');
    expect(segments[1]).toBe(ENGINE_TAG);
    expect(segments[2]).toBe('thinking');
    expect(segments[3]).toBe('2026-07-27');
  });

  it('ENGINE_TAG 不得為空、不得含分隔符（bump 的人最容易踩的雷）', () => {
    expect(ENGINE_TAG.length).toBeGreaterThan(0);
    expect(ENGINE_TAG).not.toContain('|');
  });

  it('四個輸入軸任一不同，key 就不同', () => {
    const base = buildCacheKey('fast', '2026-07-27', 'SI', 'P');
    expect(buildCacheKey('thinking', '2026-07-27', 'SI', 'P')).not.toBe(base);
    expect(buildCacheKey('fast', '2026-07-28', 'SI', 'P')).not.toBe(base);
    expect(buildCacheKey('fast', '2026-07-27', 'SI2', 'P')).not.toBe(base);
    expect(buildCacheKey('fast', '2026-07-27', 'SI', 'P2')).not.toBe(base);
  });
});

// ── 記憶體 Storage stub（比照 utils/persistentStore.test.ts） ──
const makeStorage = () => {
  const map = new Map<string, string>();
  const api = {
    map,
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
  return api;
};

describe('writeCache — 引擎段插入後跨日清理仍抓對段位', () => {
  let st: ReturnType<typeof makeStorage>;
  beforeEach(() => {
    st = makeStorage();
    vi.stubGlobal('localStorage', st as unknown as Storage);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('舊日期條目被清、今日其他條目留著', () => {
    const today = taipeiTodayStr();
    const staleKey = `${CACHE_PREFIX}${ENGINE_TAG}|fast|2000-01-01|deadbeef`;
    const todayKey = `${CACHE_PREFIX}${ENGINE_TAG}|thinking|${today}|cafebabe`;
    st.map.set(staleKey, JSON.stringify({ text: '舊的', ts: 1 }));
    st.map.set(todayKey, JSON.stringify({ text: '今天的', ts: 2 }));

    writeCache(buildCacheKey('fast', today, 'SI', 'P'), '新的');

    expect(st.map.has(staleKey)).toBe(false);
    expect(st.map.get(todayKey)).toContain('今天的');
    expect(readCache(buildCacheKey('fast', today, 'SI', 'P'))).toBe('新的');
  });

  it('舊 4 段格式的殘留條目一律清掉（不留讀不到又佔 quota 的孤兒）', () => {
    const today = taipeiTodayStr();
    // @e8d96e7 的舊格式：prefix|mode|日期|hash——沒有引擎段，日期落在 [2] 而非 [3]
    const legacyKey = `${CACHE_PREFIX}fast|${today}|deadbeef`;
    st.map.set(legacyKey, JSON.stringify({ text: '舊模型產的', ts: 1 }));

    writeCache(buildCacheKey('fast', today, 'SI', 'P'), '新的');

    expect(st.map.has(legacyKey)).toBe(false);
  });

  it('舊格式寫入的內容讀不到（換代＝當場失效）', () => {
    const today = taipeiTodayStr();
    st.map.set(`${CACHE_PREFIX}fast|${today}|${buildCacheKey('fast', today, 'SI', 'P').split('|').pop()}`,
      JSON.stringify({ text: '舊模型產的', ts: 1 }));

    expect(readCache(buildCacheKey('fast', today, 'SI', 'P'))).toBeNull();
  });

  it('localStorage 不可用時不拋錯（退化為直接打 API）', () => {
    vi.unstubAllGlobals();
    expect(() => writeCache(buildCacheKey('fast', '2026-07-27', 'SI', 'P'), 'x')).not.toThrow();
    expect(readCache(buildCacheKey('fast', '2026-07-27', 'SI', 'P'))).toBeNull();
  });
});
