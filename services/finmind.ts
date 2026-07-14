import type {
  TwBalanceSheetSummary,
  TwCashFlowSummary,
  TwDividendRecord,
  TwFundamentals,
  TwMonthlyRevenue,
  TwQuarterIncome,
  TwValuation,
} from '../types';
import { proxyHeaders } from './_shared/apiClient';

export type FinMindDataset =
  | 'TaiwanStockInstitutionalInvestorsBuySell'
  | 'TaiwanStockPrice'
  | 'TaiwanStockInfo'
  | 'TaiwanStockFinancialStatements'
  | 'TaiwanStockBalanceSheet'
  | 'TaiwanStockCashFlowsStatement'
  | 'TaiwanStockPER'
  | 'TaiwanStockMonthRevenue'
  | 'TaiwanStockDividend';

// 從 services/yahoo.ts 原樣搬來：放寬 dataset 型別以涵蓋基本面 dataset，
// json.msg==='success' 判斷與 proxyHeaders 皆不變。額外將 HTTP status 附掛於錯誤物件，
// 供 getTwFundamentals 的 429 退避判斷使用（原函式無此需求，故原本沒有）。
export const fetchFinMindRows = async (
  dataset: FinMindDataset,
  params: { data_id?: string; start_date?: string } = {},
  signal?: AbortSignal,
): Promise<any[]> => {
  const qs = new URLSearchParams({ dataset });
  if (params.data_id) qs.set('data_id', params.data_id);
  if (params.start_date) qs.set('start_date', params.start_date);

  const res = await fetch(`/api/finmind?${qs}`, {
    headers: { ...proxyHeaders },
    signal,
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({})) as { message?: string };
    const error = new Error(parsed.message || `FinMind fetch error (${res.status})`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  const json = await res.json();
  return (json.msg === 'success' && Array.isArray(json.data)) ? json.data : [];
};

// ── 內部：日期字串工具（start_date 量化到月初，提升 CDN 快取命中）──────
function firstOfMonthMinusYears(years: number): string {
  const now = new Date();
  const y = now.getFullYear() - years;
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

function firstOfMonthMinusMonths(months: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function taipeiTodayStr(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  parts.forEach(({ type, value }) => { map[type] = value; });
  return `${map.year}-${map.month}-${map.day}`;
}

// ── 內部：數值換算（照抄 fetch_fundamentals.py 的 yi()）────────────
const YI = 1e8;

function toYi(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / YI) * 100) / 100;
}

function round2(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

// pivot_latest（fetch_fundamentals.py L64-82）：長格式 [{date,type,value}] 依 date 分組，
// 抽出 want 內指定的 type（依候選碼順序取第一個非 null），回傳最後 nDates 個日期。
function pivotByDate(
  rows: any[],
  want: Record<string, string[]>,
  nDates = 1,
): Array<Record<string, any>> {
  const byDate = new Map<string, Record<string, any>>();
  rows.forEach(r => {
    if (!byDate.has(r.date)) byDate.set(r.date, {});
    byDate.get(r.date)![r.type] = r.value;
  });

  const dates = Array.from(byDate.keys()).sort().slice(-nDates);
  return dates.map(date => {
    const cells = byDate.get(date)!;
    const rec: Record<string, any> = { date };
    Object.entries(want).forEach(([key, candidates]) => {
      let val: any = null;
      for (const c of candidates) {
        if (cells[c] !== undefined && cells[c] !== null) {
          val = cells[c];
          break;
        }
      }
      rec[key] = val;
    });
    return rec;
  });
}

// ── 內部：build* 系列（照抄 fetch_fundamentals.py build_income/build_balance/...）──
function buildIncome(rows: any[], n = 8): TwQuarterIncome[] {
  const want: Record<string, string[]> = {
    revenue: ['Revenue'],
    gross_profit: ['GrossProfit'],
    operating_income: ['OperatingIncome'],
    pretax_income: ['PreTaxIncome'],
    // 淨利：一般股用 IncomeAfterTaxes（複數），金融股用 IncomeAfterTax（單數），再退而求其次。
    net_income: ['IncomeAfterTaxes', 'IncomeAfterTax', 'TotalConsolidatedProfitForThePeriod', 'IncomeFromContinuingOperations'],
    eps: ['EPS'],
  };

  return pivotByDate(rows, want, n).map(rec => {
    const rev = rec.revenue;
    const margin = (x: any): number | null => {
      if (!rev || x === null || x === undefined) return null;
      const xn = Number(x);
      const revn = Number(rev);
      if (!Number.isFinite(xn) || !Number.isFinite(revn)) return null;
      return Math.round((xn / revn) * 100 * 100) / 100;
    };

    return {
      quarter: rec.date,
      revenueYi: toYi(rev),
      grossProfitYi: toYi(rec.gross_profit),
      operatingIncomeYi: toYi(rec.operating_income),
      pretaxIncomeYi: toYi(rec.pretax_income),
      netIncomeYi: toYi(rec.net_income),
      eps: round2(rec.eps),
      grossMarginPct: margin(rec.gross_profit),
      operatingMarginPct: margin(rec.operating_income),
      netMarginPct: margin(rec.net_income),
    };
  });
}

function buildBalance(rows: any[]): TwBalanceSheetSummary | null {
  const want: Record<string, string[]> = {
    cash: ['CashAndCashEquivalents'],
    receivables: ['AccountsReceivableNet'],
    inventories: ['Inventories'],
    current_assets: ['CurrentAssets'],
    ppe: ['PropertyPlantAndEquipment'],
    total_assets: ['TotalAssets'],
    total_liabilities: ['Liabilities', 'TotalLiabilities', 'LiabilitiesTotal'],
    equity: ['Equity', 'EquityAttributableToOwnersOfParent', 'TotalEquity', 'EquityTotal'],
  };

  const piv = pivotByDate(rows, want, 1);
  if (piv.length === 0) return null;
  const r = piv[0];
  const ta = r.total_assets;
  const tl = r.total_liabilities;

  let debtRatioPct: number | null = null;
  if (ta && tl) {
    const tan = Number(ta);
    const tln = Number(tl);
    if (Number.isFinite(tan) && Number.isFinite(tln)) {
      debtRatioPct = Math.round((tln / tan) * 100 * 100) / 100;
    }
  }

  return {
    date: r.date,
    cashYi: toYi(r.cash),
    receivablesYi: toYi(r.receivables),
    inventoriesYi: toYi(r.inventories),
    currentAssetsYi: toYi(r.current_assets),
    ppeYi: toYi(r.ppe),
    totalAssetsYi: toYi(ta),
    totalLiabilitiesYi: toYi(tl),
    equityYi: toYi(r.equity),
    debtRatioPct,
  };
}

function buildCashflow(rows: any[]): TwCashFlowSummary | null {
  const want: Record<string, string[]> = {
    operating_cf: ['NetCashInflowFromOperatingActivities', 'CashFlowsFromOperatingActivities'],
    investing_cf: ['CashProvidedByInvestingActivities'],
    financing_cf: ['CashFlowsProvidedFromFinancingActivities'],
    capex: ['PropertyAndPlantAndEquipment'],
  };

  const piv = pivotByDate(rows, want, 1);
  if (piv.length === 0) return null;
  const r = piv[0];
  const ocf = r.operating_cf;
  const capex = r.capex;

  let fcf: number | null = null;
  if (ocf !== null && ocf !== undefined && capex !== null && capex !== undefined) {
    const ocfn = Number(ocf);
    const capexn = Number(capex);
    if (Number.isFinite(ocfn) && Number.isFinite(capexn)) {
      fcf = ocfn + capexn; // capex 為負值，故用加號
    }
  }

  return {
    date: r.date,
    operatingCfYi: toYi(ocf),
    investingCfYi: toYi(r.investing_cf),
    financingCfYi: toYi(r.financing_cf),
    capexYi: toYi(capex),
    freeCashFlowYi: toYi(fcf),
  };
}

function buildMonthlyRevenue(rows: any[], n = 13): TwMonthlyRevenue[] {
  const byYm = new Map<number, any>();
  rows.forEach(r => {
    byYm.set(r.revenue_year * 100 + r.revenue_month, r.revenue ?? null);
  });

  const keys = Array.from(byYm.keys()).sort((a, b) => a - b).slice(-n);
  return keys.map(key => {
    const y = Math.floor(key / 100);
    const m = key % 100;
    const cur = byYm.get(key);
    const prev = byYm.get((y - 1) * 100 + m);

    let yoyPct: number | null = null;
    if (cur !== null && cur !== undefined && prev) {
      const curn = Number(cur);
      const prevn = Number(prev);
      if (Number.isFinite(curn) && Number.isFinite(prevn)) {
        yoyPct = Math.round(((curn - prevn) / prevn) * 100 * 100) / 100;
      }
    }

    return {
      ym: `${y}-${String(m).padStart(2, '0')}`,
      revenueYi: toYi(cur),
      yoyPct,
    };
  });
}

function buildDividends(rows: any[], n = 5): TwDividendRecord[] {
  const candidates = rows.slice(-n * 2);
  const out: TwDividendRecord[] = [];

  candidates.forEach(r => {
    const cash = (r.CashEarningsDistribution || 0) + (r.CashStatutorySurplus || 0);
    const stock = (r.StockEarningsDistribution || 0) + (r.StockStatutorySurplus || 0);
    if (cash === 0 && stock === 0) return;

    out.push({
      period: r.year,
      announceDate: r.date ?? null,
      cashDividend: Math.round(cash * 10000) / 10000,
      stockDividend: Math.round(stock * 10000) / 10000,
      exDate: r.CashExDividendTradingDate || r.StockExDividendTradingDate || null,
    });
  });

  return out.slice(-n);
}

// ── 前端雙層快取：模組層 Map（切頁往返不重抓）＋ sessionStorage（F5 不重抓、跨日失效）──
const memoryCache = new Map<string, TwFundamentals>();

function cacheKeyFor(stockId: string): string {
  return `tw_fund_${stockId}_${taipeiTodayStr()}`;
}

function readSessionCache(key: string): TwFundamentals | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as TwFundamentals : null;
  } catch {
    return null;
  }
}

function writeSessionCache(key: string, data: TwFundamentals): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch {
    // 儲存失敗（無痕模式／容量已滿）非致命，略過即可
  }
}

// ── 主入口 ──────────────────────────────────────────────
// 只接受純代碼；呼叫端須先 strip .TW/.TWO（後端 validateFinMindParams 仍會再次正規化 data_id）。
export const getTwFundamentals = async (
  stockId: string,
  opts: { force?: boolean } = {},
): Promise<TwFundamentals> => {
  const cacheKey = cacheKeyFor(stockId);

  if (opts.force) {
    memoryCache.delete(cacheKey);
    try { sessionStorage.removeItem(cacheKey); } catch { /* ignore */ }
  } else {
    const cached = memoryCache.get(cacheKey) ?? readSessionCache(cacheKey);
    if (cached) {
      memoryCache.set(cacheKey, cached);
      return cached;
    }
  }

  const start3y = firstOfMonthMinusYears(3);
  const perStart = firstOfMonthMinusMonths(2);

  const requests: Array<{ label: string; dataset: FinMindDataset; params: { data_id: string; start_date: string } }> = [
    { label: 'info', dataset: 'TaiwanStockInfo', params: { data_id: stockId, start_date: '2015-01-01' } },
    { label: 'income_statement', dataset: 'TaiwanStockFinancialStatements', params: { data_id: stockId, start_date: start3y } },
    { label: 'balance_sheet', dataset: 'TaiwanStockBalanceSheet', params: { data_id: stockId, start_date: start3y } },
    { label: 'cash_flow', dataset: 'TaiwanStockCashFlowsStatement', params: { data_id: stockId, start_date: start3y } },
    { label: 'valuation', dataset: 'TaiwanStockPER', params: { data_id: stockId, start_date: perStart } },
    { label: 'monthly_revenue', dataset: 'TaiwanStockMonthRevenue', params: { data_id: stockId, start_date: start3y } },
    { label: 'dividends', dataset: 'TaiwanStockDividend', params: { data_id: stockId, start_date: '2019-01-01' } },
  ];

  const results = await Promise.allSettled(
    requests.map(r => fetchFinMindRows(r.dataset, r.params)),
  );

  // 429 退避：對 RATE_LIMITED 失敗項等 2 秒只重試那幾個一次，不做指數退避。
  const rateLimitedIdx = results
    .map((r, i) => (r.status === 'rejected' && r.reason?.status === 429 ? i : -1))
    .filter(i => i >= 0);

  if (rateLimitedIdx.length > 0) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const retried = await Promise.allSettled(
      rateLimitedIdx.map(i => fetchFinMindRows(requests[i].dataset, requests[i].params)),
    );
    retried.forEach((r, j) => {
      results[rateLimitedIdx[j]] = r;
    });
  }

  const warnings: string[] = [];
  const rowsFor = (label: string): any[] => {
    const idx = requests.findIndex(r => r.label === label);
    const result = results[idx];
    if (result.status === 'fulfilled') return result.value;
    warnings.push(label);
    return [];
  };

  const infoRows = rowsFor('info');
  const incomeQuarters = buildIncome(rowsFor('income_statement'));
  const balanceSheet = buildBalance(rowsFor('balance_sheet'));
  const cashFlow = buildCashflow(rowsFor('cash_flow'));
  const valuationRows = rowsFor('valuation');
  const monthlyRevenue = buildMonthlyRevenue(rowsFor('monthly_revenue'));
  const dividends = buildDividends(rowsFor('dividends'));

  let valuation: TwValuation | null = null;
  if (valuationRows.length > 0) {
    const r = valuationRows[valuationRows.length - 1];
    valuation = {
      date: r.date,
      per: r.PER ?? null,
      pbr: r.PBR ?? null,
      dividendYieldPct: r.dividend_yield ?? null,
    };
  }

  // 整頁失敗判準（沿用 py 版）：incomeQuarters＋balanceSheet＋valuation 全空 → 視為整體失敗。
  if (incomeQuarters.length === 0 && !balanceSheet && !valuation) {
    throw new Error('所有 FinMind 資料集皆抓取失敗，可能為限流或代碼錯誤。');
  }

  const fundamentals: TwFundamentals = {
    stockId,
    name: infoRows[0]?.stock_name ?? null,
    industry: infoRows[0]?.industry_category ?? null,
    asOf: taipeiTodayStr(),
    valuation,
    incomeQuarters,
    balanceSheet,
    cashFlow,
    monthlyRevenue,
    dividends,
    warnings,
  };

  memoryCache.set(cacheKey, fundamentals);
  writeSessionCache(cacheKey, fundamentals);

  return fundamentals;
};
