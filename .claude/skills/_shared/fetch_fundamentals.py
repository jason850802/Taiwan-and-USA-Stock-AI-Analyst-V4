#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_fundamentals.py — 台股「基本面」資料來源（給 tw-fundamentals skill 用）
================================================================================
補上美股 skill 從 SEC/EDGAR 自動取得、台股卻缺的那一層資料：
損益表、資產負債表、現金流量表、PER/PBR/殖利率、月營收(YoY)、股利、公司基本資料。
全部走 FinMind 免 token 的公開 dataset（你專案既有依賴），回傳單一 JSON。

用法:
    python fetch_fundamentals.py 2330            # 台股代碼（純數字）
    python fetch_fundamentals.py 2330 --years 3  # 取近 N 年（預設 3）

輸出: stdout 一段 JSON。單一 dataset 失敗只記進 warnings、不中斷；
      全部失敗才回 {"error": "..."}。金額單位：新台幣「億元」(原始值 ÷ 1e8)。

設計對齊 fetch_stock.py：純標準庫(urllib)、UTF-8、失敗回 JSON。不需 pip 安裝。
"""
import sys, json, time, urllib.request, urllib.parse, ssl, datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = "https://api.finmindtrade.com/api/v4/data"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
YI = 1e8  # 億


def _get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return json.loads(r.read().decode("utf-8"))


def dataset(name, data_id, start_date, retries=2):
    """抓一個 FinMind dataset，回傳 data list；失敗 raise。"""
    q = urllib.parse.urlencode({"dataset": name, "data_id": data_id, "start_date": start_date})
    last = None
    for _ in range(retries + 1):
        try:
            d = _get(f"{BASE}?{q}")
            if d.get("status") == 200:
                return d.get("data", [])
            last = d.get("msg", "non-200")
        except Exception as e:
            last = str(e)
            time.sleep(1)
    raise RuntimeError(f"{name}: {last}")


def yi(v):
    """原始新台幣 → 億元，2 位小數；None 安全。"""
    try:
        return round(float(v) / YI, 2)
    except (TypeError, ValueError):
        return None


def pivot_latest(rows, want, n_dates=1):
    """把 FinMind 長格式 [{date,type,value}] 依 date 分組，抽出 want 內的 type。
    回傳最後 n_dates 個日期的 [{date, <key>:值...}]（值已轉億元）。"""
    by_date = {}
    for r in rows:
        by_date.setdefault(r["date"], {})[r["type"]] = r.get("value")
    out = []
    for date in sorted(by_date)[-n_dates:]:
        rec = {"date": date}
        cells = by_date[date]
        for key, candidates in want.items():
            val = None
            for c in candidates:
                if c in cells and cells[c] is not None:
                    val = cells[c]
                    break
            rec[key] = val
        out.append(rec)
    return out


def build_income(rows, n=8):
    want = {
        "revenue": ["Revenue"], "gross_profit": ["GrossProfit"],
        "operating_income": ["OperatingIncome"], "pretax_income": ["PreTaxIncome"],
        # 淨利：一般股用 IncomeAfterTaxes(複數)，金融股用 IncomeAfterTax(單數)，再退而求其次
        "net_income": ["IncomeAfterTaxes", "IncomeAfterTax",
                       "TotalConsolidatedProfitForThePeriod", "IncomeFromContinuingOperations"],
        "eps": ["EPS"],
    }
    out = []
    for rec in pivot_latest(rows, want, n_dates=n):
        rev = rec["revenue"]
        def margin(x):
            try:
                return round(float(x) / float(rev) * 100, 2) if rev else None
            except (TypeError, ValueError):
                return None
        out.append({
            "quarter": rec["date"],
            "revenue_yi": yi(rev), "gross_profit_yi": yi(rec["gross_profit"]),
            "operating_income_yi": yi(rec["operating_income"]),
            "pretax_income_yi": yi(rec["pretax_income"]),
            "net_income_yi": yi(rec["net_income"]),
            "eps": (round(float(rec["eps"]), 2) if rec["eps"] is not None else None),
            "gross_margin_pct": margin(rec["gross_profit"]),
            "operating_margin_pct": margin(rec["operating_income"]),
            "net_margin_pct": margin(rec["net_income"]),
        })
    return out


def build_balance(rows):
    want = {
        "cash": ["CashAndCashEquivalents"], "receivables": ["AccountsReceivableNet"],
        "inventories": ["Inventories"], "current_assets": ["CurrentAssets"],
        "ppe": ["PropertyPlantAndEquipment"], "total_assets": ["TotalAssets"],
        "total_liabilities": ["Liabilities", "TotalLiabilities", "LiabilitiesTotal"],
        "equity": ["Equity", "EquityAttributableToOwnersOfParent", "TotalEquity", "EquityTotal"],
    }
    piv = pivot_latest(rows, want, n_dates=1)
    if not piv:
        return None
    r = piv[0]
    ta, tl = r["total_assets"], r["total_liabilities"]
    debt_ratio = None
    try:
        debt_ratio = round(float(tl) / float(ta) * 100, 2) if ta and tl else None
    except (TypeError, ValueError):
        pass
    return {
        "date": r["date"], "cash_yi": yi(r["cash"]), "receivables_yi": yi(r["receivables"]),
        "inventories_yi": yi(r["inventories"]), "current_assets_yi": yi(r["current_assets"]),
        "ppe_yi": yi(r["ppe"]), "total_assets_yi": yi(ta),
        "total_liabilities_yi": yi(tl), "equity_yi": yi(r["equity"]),
        "debt_ratio_pct": debt_ratio,
    }


def build_cashflow(rows):
    want = {
        "operating_cf": ["NetCashInflowFromOperatingActivities", "CashFlowsFromOperatingActivities"],
        "investing_cf": ["CashProvidedByInvestingActivities"],
        "financing_cf": ["CashFlowsProvidedFromFinancingActivities"],
        "capex": ["PropertyAndPlantAndEquipment"],
    }
    piv = pivot_latest(rows, want, n_dates=1)
    if not piv:
        return None
    r = piv[0]
    ocf, capex = r["operating_cf"], r["capex"]
    fcf = None
    try:
        if ocf is not None and capex is not None:
            fcf = float(ocf) + float(capex)  # capex 為負值
    except (TypeError, ValueError):
        pass
    return {
        "date": r["date"], "operating_cf_yi": yi(ocf), "investing_cf_yi": yi(r["investing_cf"]),
        "financing_cf_yi": yi(r["financing_cf"]), "capex_yi": yi(capex),
        "free_cash_flow_yi": yi(fcf),
    }


def build_monthly_revenue(rows, n=13):
    by_ym = {}
    for r in rows:
        by_ym[(r["revenue_year"], r["revenue_month"])] = r.get("revenue")
    keys = sorted(by_ym)[-n:]
    out = []
    for (y, m) in keys:
        cur = by_ym[(y, m)]
        prev = by_ym.get((y - 1, m))
        yoy = None
        try:
            if cur is not None and prev:
                yoy = round((float(cur) - float(prev)) / float(prev) * 100, 2)
        except (TypeError, ValueError):
            pass
        out.append({"ym": f"{y}-{m:02d}", "revenue_yi": yi(cur), "yoy_pct": yoy})
    return out


def build_dividends(rows, n=5):
    out = []
    for r in rows[-n * 2:]:
        cash = (r.get("CashEarningsDistribution") or 0) + (r.get("CashStatutorySurplus") or 0)
        stock = (r.get("StockEarningsDistribution") or 0) + (r.get("StockStatutorySurplus") or 0)
        if cash == 0 and stock == 0:
            continue
        out.append({
            "period": r.get("year"), "announce_date": r.get("date"),
            "cash_dividend": round(cash, 4), "stock_dividend": round(stock, 4),
            "ex_date": r.get("CashExDividendTradingDate") or r.get("StockExDividendTradingDate"),
        })
    return out[-n:]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(json.dumps({"error": "用法: python fetch_fundamentals.py <台股代碼> (例 2330)"}, ensure_ascii=False))
        return
    sid = args[0].strip().upper().replace(".TW", "").replace(".TWO", "")
    years = 3
    if "--years" in sys.argv:
        try:
            years = int(sys.argv[sys.argv.index("--years") + 1])
        except (ValueError, IndexError):
            pass
    start = (datetime.date.today() - datetime.timedelta(days=365 * years + 60)).isoformat()
    per_start = (datetime.date.today() - datetime.timedelta(days=30)).isoformat()

    out = {"stock_id": sid, "market": "台股", "unit": "金額為新台幣億元(原始值÷1e8)；EPS/股利為元/股",
           "as_of": datetime.date.today().isoformat(), "warnings": []}

    def safe(label, fn):
        try:
            return fn()
        except Exception as e:
            out["warnings"].append(f"{label}: {e}")
            return None

    info = safe("info", lambda: dataset("TaiwanStockInfo", sid, "2015-01-01"))
    if info:
        out["name"] = info[0].get("stock_name")
        out["industry"] = info[0].get("industry_category")

    is_rows = safe("income_statement", lambda: dataset("TaiwanStockFinancialStatements", sid, start))
    out["income_statement"] = build_income(is_rows) if is_rows else []

    bs_rows = safe("balance_sheet", lambda: dataset("TaiwanStockBalanceSheet", sid, start))
    out["balance_sheet"] = build_balance(bs_rows) if bs_rows else None

    cf_rows = safe("cash_flow", lambda: dataset("TaiwanStockCashFlowsStatement", sid, start))
    out["cash_flow"] = build_cashflow(cf_rows) if cf_rows else None

    per_rows = safe("valuation", lambda: dataset("TaiwanStockPER", sid, per_start))
    if per_rows:
        r = per_rows[-1]
        out["valuation"] = {"date": r.get("date"), "PER": r.get("PER"),
                            "PBR": r.get("PBR"), "dividend_yield_pct": r.get("dividend_yield")}
    else:
        out["valuation"] = None

    mr_rows = safe("monthly_revenue", lambda: dataset("TaiwanStockMonthRevenue", sid, start))
    out["monthly_revenue"] = build_monthly_revenue(mr_rows) if mr_rows else []

    dv_rows = safe("dividends", lambda: dataset("TaiwanStockDividend", sid, "2019-01-01"))
    out["dividends"] = build_dividends(dv_rows) if dv_rows else []

    # 全部關鍵資料都沒抓到才算整體失敗
    if not any([out["income_statement"], out["balance_sheet"], out["valuation"]]):
        print(json.dumps({"error": "所有 FinMind dataset 皆抓取失敗（可能限流或代碼錯誤）",
                          "stock_id": sid, "warnings": out["warnings"]}, ensure_ascii=False))
        return
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
