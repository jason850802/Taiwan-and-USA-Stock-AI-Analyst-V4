// ───────────────────────────────────────────────────────────────
// 庫存健檢決策解析器（LLM 回應 → 結構化決策）
// 零 import 純模組：不得觸碰任何瀏覽器全域——
// 本模組須可用 esbuild 轉 CJS 後在 node 直測（照 geminiCache.ts 先例）。
//
// 契約：analyzePortfolioHealth 的 systemInstruction 規定模型在報告
// 最末尾輸出一個 ```json 圍欄區塊 {"decisions":[{"symbol":"...","decision":"..."}]}；
// json 缺失/損壞時回 null，呼叫端 fallback 至 extractDecisionByRegex（舊行為下限）。
// ───────────────────────────────────────────────────────────────

export const HEALTH_DECISIONS = ['加碼', '續抱', '減碼', '停利', '停損'] as const;
export type HealthDecision = typeof HEALTH_DECISIONS[number];

export const DECISION_EMOJI: Record<HealthDecision, string> = {
  加碼: '🟢',
  續抱: '🔵',
  減碼: '🟡',
  停利: '🟠',
  停損: '🔴',
};

export interface HealthDecisionEntry {
  symbol: string;
  decision: HealthDecision;
}

export interface ParsedHealthDecisions {
  decisions: HealthDecisionEntry[];
  cleanedMarkdown: string;
}

/**
 * 解析報告末尾的機器可讀決策區（json 圍欄區塊）。
 * 取最後一個 ```json 區塊（報告本體可能含其他 json 例示區塊，契約規定機器區在最末尾）。
 * 任何失敗（無匹配／parse 拋錯／shape 不符／枚舉外值）→ 回傳 null，不拋錯。
 */
export function parseHealthDecisions(fullText: string): ParsedHealthDecisions | null {
  const fenceRe = /```json\s*([\s\S]*?)```/g;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(fullText)) !== null) {
    lastMatch = m;
  }
  if (!lastMatch) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(lastMatch[1]);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const decisionsRaw = (parsed as { decisions?: unknown }).decisions;
  if (!Array.isArray(decisionsRaw) || decisionsRaw.length === 0) return null;

  const decisions: HealthDecisionEntry[] = [];
  for (const entry of decisionsRaw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const symbol = (entry as { symbol?: unknown }).symbol;
    const decisionRaw = (entry as { decision?: unknown }).decision;
    if (typeof symbol !== 'string' || symbol.length === 0) return null;
    if (typeof decisionRaw !== 'string') return null;
    const decision = decisionRaw.trim();
    if (!(HEALTH_DECISIONS as readonly string[]).includes(decision)) return null;
    decisions.push({ symbol, decision: decision as HealthDecision });
  }

  const cleanedMarkdown = (
    fullText.slice(0, lastMatch.index) + fullText.slice(lastMatch.index + lastMatch[0].length)
  ).trimEnd();

  return { decisions, cleanedMarkdown };
}

/**
 * regex fallback：對人讀 markdown 撈「操作決策」字樣（Portfolio.tsx 原 :965 regex 逐字搬移）。
 * 命中回含 emoji 前綴的壓縮字串（如 `🟢加碼`），未命中回 null。
 */
export function extractDecisionByRegex(markdown: string): string | null {
  const match = markdown.match(/操作決策[：:]\s*[【\[]?\s*(🟢\s*加碼|🔵\s*續抱|🟡\s*減碼|🟠\s*停利|🔴\s*停損)/);
  return match ? match[1].replace(/\s+/g, '') : null;
}

export interface SplitHealthReport {
  perSymbol: Record<string, string>;
  overview: string;
}

/**
 * 批次報告切段：按「### 📋 持股健檢報告：」標頭切段，各 symbol 認領各自段落。
 * 總覽段（### 📊 庫存總覽／### 💡 整體操作建議）從最後一段截出。
 * 任何認領失敗（0 標頭／缺段／歧義）→ 回傳 null（呼叫端 fallback 整份全文）。
 */
export function splitHealthReport(markdown: string, symbols: string[]): SplitHealthReport | null {
  // 📋 是 surrogate pair，`📋?` 在無 u flag 下只會讓低位代理可選——必須用非捕獲組包裹
  const headerRe = /^###\s*(?:📋)?\s*持股健檢報告[：:].*$/gm;
  const headers: { index: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(markdown)) !== null) {
    headers.push({ index: m.index, text: m[0] });
  }
  if (headers.length === 0) return null;

  const sections: { headerText: string; body: string }[] = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index;
    const end = i + 1 < headers.length ? headers[i + 1].index : markdown.length;
    sections.push({ headerText: headers[i].text, body: markdown.slice(start, end) });
  }

  // 總覽切割：在最後一段內搜尋 📊/💡 標頭，找到則該段在此截止、其後全部為 overview
  let overview = '';
  const lastSection = sections[sections.length - 1];
  const overviewMatch = lastSection.body.match(/^###\s*(?:📊|💡)/m);
  if (overviewMatch && overviewMatch.index != null) {
    overview = lastSection.body.slice(overviewMatch.index);
    lastSection.body = lastSection.body.slice(0, overviewMatch.index);
  }

  // symbol→段映射：依字串長度降冪逐一認領（防 6488.TW 是 6488.TWO 子字串類邊角）
  const sortedSymbols = [...symbols].sort((a, b) => b.length - a.length);
  const claimed = new Array<boolean>(sections.length).fill(false);
  const perSymbol: Record<string, string> = {};

  for (const symbol of sortedSymbols) {
    const candidates: number[] = [];
    for (let i = 0; i < sections.length; i++) {
      if (!claimed[i] && sections[i].headerText.includes(symbol)) candidates.push(i);
    }
    if (candidates.length !== 1) return null; // 0 段或歧義 → 整體失敗
    claimed[candidates[0]] = true;
    perSymbol[symbol] = sections[candidates[0]].body.trim();
  }

  return { perSymbol, overview: overview.trim() };
}
