// 合成資料集中定義，07／08／12 重跑同一份；無真實市場或投資組合資料。
const isoDay = timestamp => new Date(timestamp * 1000).toISOString().slice(0, 10);
export function chart(symbol, interval, count) {
  const step = interval === '60m' ? 3600 : interval === '1wk' ? 604800 : 86400;
  const timestamp = Array.from({ length: count }, (_, i) => 1789750800 - (count - 1 - i) * step);
  const close = timestamp.map((_, i) => symbol.endsWith('=X') ? 32 : 100 + i / 10 + Math.sin(i));
  return { chart: { error: null, result: [{
    meta: { symbol, longName: `合成行情 ${symbol}`, currency: symbol.endsWith('.TW') ? 'TWD' : 'USD',
      exchangeTimezoneName: symbol.endsWith('.TW') ? 'Asia/Taipei' : 'America/New_York', regularMarketPrice: close.at(-1) },
    timestamp, indicators: { quote: [{ open: close.map(x => x - 1), high: close.map(x => x + 2), low: close.map(x => x - 2), close, volume: close.map(() => 1000000) }] },
  }] } };
}

export function finmind(dataset, id) {
  if (dataset === 'TaiwanStockInfo') return id ? [{ stock_id: id, stock_name: `合成公司 ${id}`, type: 'twse' }] : [];
  if (dataset === 'TaiwanStockPER') return [{ date: '2026-09-18', PER: 15, PBR: 2, dividend_yield: 3 }];
  if (dataset === 'TaiwanStockFinancialStatements') {
    return Array.from({ length: 8 }, (_, i) => ['Revenue', 'GrossProfit', 'OperatingIncome', 'PreTaxIncome', 'IncomeAfterTaxes', 'EPS']
      .map((type, j) => ({ date: isoDay(1788220800 - i * 7776000), type, value: type === 'EPS' ? 3 : 10000000000 / (j + 1) }))).flat();
  }
  if (dataset === 'TaiwanStockBalanceSheet') return ['CashAndCashEquivalents', 'AccountsReceivableNet', 'Inventories', 'CurrentAssets', 'PropertyPlantAndEquipment', 'Assets', 'Liabilities', 'Equity']
    .map((type, i) => ({ date: '2026-06-30', type, value: 10000000000 / (i + 1) }));
  if (dataset === 'TaiwanStockCashFlowsStatement') return ['CashFlowsFromOperatingActivities', 'CashProvidedByInvestingActivities', 'CashFlowsProvidedFromFinancingActivities', 'PropertyAndPlantAndEquipment']
    .map((type, i) => ({ date: '2026-06-30', type, value: i === 0 ? 1000000000 : -100000000 }));
  if (dataset === 'TaiwanStockMonthRevenue') return Array.from({ length: 36 }, (_, i) => ({ revenue_year: 2024 + Math.floor(i / 12), revenue_month: i % 12 + 1, revenue: 1000000000 + i * 10000000 }));
  if (dataset === 'TaiwanStockDividend') return Array.from({ length: 5 }, (_, i) => ({ date: `${2022 + i}-06-01`, year: 2022 + i, CashEarningsDistribution: 2, CashExDividendTradingDate: `${2022 + i}-07-01` }));
  return [];
}
