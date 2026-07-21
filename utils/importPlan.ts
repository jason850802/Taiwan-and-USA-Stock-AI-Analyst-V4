// utils/importPlan.ts — 由解析結果產生「匯入計畫」供預覽（Phase 11 T3，純函式）
import { PortfolioItem, ParsedTxn, ImportPlan, ImportGap, BrokerId } from '../types';
import { sortTxns } from './statementParsers';
import { replayStatement } from './importReplay';

export interface BuildPlanInput {
  broker: BrokerId;
  txns: ParsedTxn[];
  unsupported: { rawLine: string; reason: string }[];
  importedKeys: string[];
  existingLots: PortfolioItem[];
  now?: number;
}

/**
 * 去重 → 排序 → 試跑重播（不落地）以偵測期初缺口，產出預覽統計。
 * 重播在此僅為「乾跑」，實際套用由呼叫端在使用者確認後再跑一次（含補值後的 gaps）。
 */
export const buildImportPlan = (input: BuildPlanInput): ImportPlan => {
  const { broker, unsupported, importedKeys, existingLots, now = Date.now() } = input;
  const seen = new Set(importedKeys);

  const fresh: ParsedTxn[] = [];
  let skippedDuplicates = 0;
  const withinFile = new Set<string>();
  for (const t of input.txns) {
    if (seen.has(t.dedupeKey) || withinFile.has(t.dedupeKey)) {
      skippedDuplicates++;
      continue;
    }
    withinFile.add(t.dedupeKey);
    fresh.push(t);
  }

  const txns = sortTxns(fresh);
  const dry = replayStatement({ txns, existingLots, now });

  return {
    broker,
    txns,
    skippedDuplicates,
    unsupported,
    gaps: dry.gaps,
    preview: { buys: dry.applied.buys, sells: dry.applied.sells, dividends: dry.applied.dividends },
    dateRange: txns.length > 0 ? { from: txns[0].date, to: txns[txns.length - 1].date } : null,
  };
};

/** 缺口是否已全部填妥（未填的會在套用時被略過） */
export const countFilledGaps = (gaps: ImportGap[]): number =>
  gaps.filter(g => g.costPerShare !== undefined && g.costPerShare >= 0).length;
