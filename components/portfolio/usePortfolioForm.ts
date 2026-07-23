// components/portfolio/usePortfolioForm.ts — 新增持股表單（Phase 12 T6a 自 Portfolio.tsx 平移）
// 持有 form／feeInput／feeTouched／showAddModal 四組 state＋手續費自動試算 effect＋
// 試算預覽＋submit 組裝（handleAdd）。邏輯零改寫，只有 rate 的硬編 32 改引用 utils/fx（D-07）。
//
// feeTouched 語意（改前先想）：使用者手動改過手續費欄後，自動試算就永久讓位（直到送出重置）；
// effect 的第一個 early-return 就是這個開關，依賴陣列動到它前先跑 npm run test。
import { useEffect, useState } from 'react';
import { PortfolioItem } from '../../types';
import { isTwStock, calcTwBuyFee, calcUsFee } from '../../utils/portfolioFees';
import { USD_TWD_FALLBACK } from '../../utils/fx';

export const usePortfolioForm = (
  onAdd: (item: Omit<PortfolioItem, 'id'>) => void,
  usdTwdRate: number,
) => {
  const [showAddModal, setShowAddModal] = useState(false);

  // 新增表單
  const [form, setForm] = useState({
    symbol:           '',
    inputMode:        'avg' as 'avg' | 'total',
    avgCostPrice:     '',
    totalCostInput:   '',
    totalShares:      '',
    brokerDiscount:   '',
    cashDividends:    '',
    stockDividends:   '',
    purchaseCurrency: 'USD' as 'TWD' | 'USD', // for US stocks
    isUsEtf:          false,
    buyDate:          '',     // 買入時間（分析用）
    buyReason:        '',     // 買入原因（分析用）
    buyDateRecord:    '',     // 買進日期（存入持股，回推歷史用；與上面 AI 分析欄位無關）
  });
  const [feeInput, setFeeInput] = useState('');
  const [feeTouched, setFeeTouched] = useState(false);

  // ── 表單輔助 ───────────────────────────────────────────────────────────
  const formIsTW = isTwStock(form.symbol);
  const shares   = parseFloat(form.totalShares)    || 0;
  const rate     = usdTwdRate > 0 ? usdTwdRate : USD_TWD_FALLBACK;

  useEffect(() => {
    if (feeTouched) return;
    if (formIsTW && form.inputMode === 'total') {
      setFeeInput('');
      return;
    }

    const avg = parseFloat(form.avgCostPrice) || 0;
    const totalInput = parseFloat(form.totalCostInput) || 0;
    const base = form.inputMode === 'avg' ? avg * shares : totalInput;
    if (base <= 0) {
      setFeeInput('');
      return;
    }

    if (formIsTW) {
      setFeeInput(String(calcTwBuyFee(base)));
      return;
    }

    const fee = form.purchaseCurrency === 'USD'
      ? calcUsFee(base, form.isUsEtf)
      : calcUsFee(base / rate, form.isUsEtf) * rate;
    setFeeInput(String(Number(fee.toFixed(2))));
  }, [feeTouched, form.avgCostPrice, form.inputMode, form.isUsEtf, form.purchaseCurrency,
    form.totalCostInput, formIsTW, rate, shares]);

  const preview = (() => {
    const avg       = parseFloat(form.avgCostPrice)   || 0;
    const totalInp  = parseFloat(form.totalCostInput) || 0;
    const enteredBuyFee = parseFloat(feeInput) || 0;

    if (formIsTW) {
      if (form.inputMode === 'avg') {
        const base   = avg * shares;
        const buyFee = enteredBuyFee;
        const total  = base + buyFee;
        return { base, buyFee, total, adjAvg: shares > 0 ? total / shares : avg, feeLabel: '買進手續費' };
      } else {
        const total = totalInp;
        return { base: total, buyFee: 0, total, adjAvg: shares > 0 ? total / shares : 0, feeLabel: '' };
      }
    } else {
      if (form.purchaseCurrency === 'USD') {
        const baseUsd = form.inputMode === 'avg' ? avg * shares : totalInp;
        const totalUsd = baseUsd + enteredBuyFee;
        const totalTwd = totalUsd * rate;
        return {
          base: baseUsd, buyFee: enteredBuyFee, total: totalUsd,
          adjAvg: shares > 0 ? totalUsd / shares : avg, totalTwd,
          feeLabel: '買進手續費',
        };
      } else {
        const baseTwd = form.inputMode === 'avg' ? avg * shares : totalInp;
        const totalTwd = baseTwd + enteredBuyFee;
        const feeUsd = enteredBuyFee / rate;
        return {
          base: baseTwd, buyFee: enteredBuyFee, total: totalTwd,
          adjAvg: shares > 0 ? totalTwd / shares : avg, feeUsd,
          feeLabel: '買進手續費',
        };
      }
    }
  })();

  // ── 新增 ───────────────────────────────────────────────────────────────
  const handleAdd = () => {
    if (!form.symbol || shares <= 0 || preview.total <= 0) return;
    const sym = form.symbol.trim().toUpperCase();

    if (formIsTW) {
      onAdd({
        symbol: sym, avgCostPrice: preview.adjAvg, totalShares: shares,
        totalCost: preview.total, brokerDiscount: 10,
        ...(form.inputMode === 'avg' ? { buyFee: preview.buyFee } : {}),
        cashDividends: parseFloat(form.cashDividends) || 0,
        stockDividends: parseFloat(form.stockDividends) || 0,
        ...(form.buyDateRecord ? { buyDate: form.buyDateRecord } : {}),
      });
    } else {
      if (form.purchaseCurrency === 'USD') {
        onAdd({
          symbol: sym, avgCostPrice: preview.adjAvg, totalShares: shares,
          totalCost: 0,                        // not used for USD purchase
          totalCostUSD: preview.total,         // fixed USD cost
          purchaseCurrency: 'USD', isUsEtf: form.isUsEtf,
          brokerDiscount: 10, buyFee: preview.buyFee,
          cashDividends: parseFloat(form.cashDividends) || 0,
          stockDividends: parseFloat(form.stockDividends) || 0,
          ...(form.buyDateRecord ? { buyDate: form.buyDateRecord } : {}),
        });
      } else {
        onAdd({
          symbol: sym, avgCostPrice: preview.adjAvg, totalShares: shares,
          totalCost: preview.total,            // fixed TWD cost
          purchaseCurrency: 'TWD', isUsEtf: form.isUsEtf,
          brokerDiscount: 10, buyFee: preview.buyFee,
          cashDividends: parseFloat(form.cashDividends) || 0,
          stockDividends: parseFloat(form.stockDividends) || 0,
          ...(form.buyDateRecord ? { buyDate: form.buyDateRecord } : {}),
        });
      }
    }

    setForm({ symbol: '', inputMode: 'avg', avgCostPrice: '', totalCostInput: '',
              totalShares: '', brokerDiscount: '', cashDividends: '', stockDividends: '',
              purchaseCurrency: 'USD', isUsEtf: false, buyDate: '', buyReason: '', buyDateRecord: '' });
    setFeeInput('');
    setFeeTouched(false);
    setShowAddModal(false);
  };

  return {
    showAddModal, setShowAddModal,
    form, setForm,
    feeInput, setFeeInput,
    feeTouched, setFeeTouched,
    formIsTW, shares, rate,
    preview, handleAdd,
  };
};
