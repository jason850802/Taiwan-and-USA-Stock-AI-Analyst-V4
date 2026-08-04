// 券商碎股最小單位為 1e-5，浮點累積噪音約 1e-13；取兩者之間作為股數容差。
export const SHARE_EPS = 1e-6;

export const fmtShares = (shares: number): string => {
  const rounded = Math.round(shares * 1e6) / 1e6;
  return rounded.toLocaleString('zh-TW', { maximumFractionDigits: 6 });
};
