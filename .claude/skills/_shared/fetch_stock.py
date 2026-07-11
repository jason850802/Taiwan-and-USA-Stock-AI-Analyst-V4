#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_stock.py — 進場分析 Skills 共用資料來源
======================================================
抓取 Yahoo Finance 的日線 / 週線 OHLCV，計算朱家泓技術分析所需的
均線、量能、KD、MACD、轉折波（頭/底）與趨勢判定，輸出單一 JSON。

用法:
    python fetch_stock.py 2330            # 台股，自動試 .TW 再 .TWO
    python fetch_stock.py AAPL            # 美股
    python fetch_stock.py 2330.TW --json  # 指定後綴
    python fetch_stock.py 6488.TWO

輸出: stdout 一段 JSON（給 skill 判讀）。失敗時輸出 {"error": "..."}。

指標參數（與講義實戰參數、App 端一致）:
    KD   : 5, 3, 3        (講義 KD 參數；App utils/math.ts calculateKDJ period=5)
    MACD : 10, 20, 10     (講義 MACD 參數；App utils/math.ts calculateMACD 10,20,10)
"""
import sys, json, time, urllib.request, urllib.parse, ssl

# 強制 UTF-8 輸出（Windows 預設 cp950 會讓中文欄位亂碼/解碼失敗）
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ---------------- 參數設定 ----------------
KD_N, KD_K, KD_D = 5, 3, 3
MACD_FAST, MACD_SLOW, MACD_SIGNAL = 10, 20, 10
SWING_K = 2          # 轉折波 fractal 視窗（前後各 K 根）
ATTACK_VOL_RATIO = 1.3   # 攻擊量門檻A（>昨日 1.3 倍）
ATTACK_VOL_BASE = 1.2    # 攻擊量門檻B（>基本量＝前5日均量 1.2 倍）；雙軌擇一成立即攻擊量

YAHOO = "https://query2.finance.yahoo.com/v8/finance/chart/"
PROXIES = ["", "https://corsproxy.io/?", "https://api.allorigins.win/raw?url="]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


# ---------------- 抓取 ----------------
def _get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return json.loads(r.read().decode("utf-8"))


def _query(symbol, interval, rng):
    target = (f"{YAHOO}{symbol}?interval={interval}&range={rng}"
              f"&includeAdjustedClose=true&includePrePost=false"
              f"&lang=zh-Hant-TW&region=TW&_={int(time.time())}")
    last_err = None
    for px in PROXIES:
        try:
            url = target if px == "" else px + urllib.parse.quote(target, safe="")
            d = _get(url)
            res = d.get("chart", {}).get("result")
            if res:
                return res[0]
            last_err = d.get("chart", {}).get("error")
        except Exception as e:
            last_err = str(e)
    raise RuntimeError(f"fetch failed for {symbol}: {last_err}")


def fetch(symbol_in, interval, rng):
    """自動判斷市場：含 .TW/.TWO 直接用；純數字試 .TW→.TWO；其餘當美股。"""
    s = symbol_in.strip().upper()
    if ".TW" in s or ".TWO" in s:
        return _query(s, interval, rng), s
    if s.replace(".", "").isalnum() and any(c.isdigit() for c in s) and s.isascii() and not s.isalpha():
        # 台股代碼樣式（含數字）：先 .TW 再 .TWO
        core = s.replace(".TW", "").replace(".TWO", "")
        try:
            return _query(f"{core}.TW", interval, rng), f"{core}.TW"
        except Exception:
            return _query(f"{core}.TWO", interval, rng), f"{core}.TWO"
    return _query(s, interval, rng), s


# ---------------- 指標 ----------------
def sma(xs, n):
    out = [None] * len(xs)
    if len(xs) < n:
        return out
    s = sum(xs[:n]); out[n-1] = s / n
    for i in range(n, len(xs)):
        s += xs[i] - xs[i-n]; out[i] = s / n
    return out


def ema(xs, n):
    out = [None] * len(xs)
    if len(xs) < n:
        return out
    k = 2 / (n + 1)
    cur = sum(xs[:n]) / n; out[n-1] = cur
    for i in range(n, len(xs)):
        cur = xs[i] * k + cur * (1 - k); out[i] = cur
    return out


def kd(high, low, close, n=KD_N, ks=KD_K, ds=KD_D):
    length = len(close)
    k_arr = [None] * length; d_arr = [None] * length
    k_prev, d_prev = 50.0, 50.0
    for i in range(length):
        if i < n - 1:
            continue
        hh = max(high[i-n+1:i+1]); ll = min(low[i-n+1:i+1])
        rsv = 50.0 if hh == ll else (close[i] - ll) / (hh - ll) * 100
        k_prev = k_prev * (ks - 1) / ks + rsv / ks
        d_prev = d_prev * (ds - 1) / ds + k_prev / ds
        k_arr[i] = k_prev; d_arr[i] = d_prev
    return k_arr, d_arr


def macd(close, fast=MACD_FAST, slow=MACD_SLOW, sig=MACD_SIGNAL):
    ef, es = ema(close, fast), ema(close, slow)
    dif = [(ef[i] - es[i]) if (ef[i] is not None and es[i] is not None) else None
           for i in range(len(close))]
    valid = [(i, v) for i, v in enumerate(dif) if v is not None]
    dea = [None] * len(close)
    if valid:
        vals = [v for _, v in valid]; idx0 = valid[0][0]
        de = ema(vals, sig)
        for j, v in enumerate(de):
            if v is not None:
                dea[idx0 + j] = v
    hist = [((dif[i] - dea[i]) if (dif[i] is not None and dea[i] is not None) else None)
            for i in range(len(close))]
    return dif, dea, hist


def swings(close, ma5, k=SWING_K):
    """以 fractal 找轉折高/低點，回傳依時間排序的 [{type,idx,price}]。"""
    pts = []
    n = len(close)
    for i in range(k, n - k):
        win = close[i-k:i+k+1]
        if close[i] == max(win) and close[i] > close[i-1]:
            pts.append({"type": "high", "idx": i, "price": round(close[i], 2)})
        elif close[i] == min(win) and close[i] < close[i-1]:
            pts.append({"type": "low", "idx": i, "price": round(close[i], 2)})
    # 去除連續同型，保留更極端者
    cleaned = []
    for p in pts:
        if cleaned and cleaned[-1]["type"] == p["type"]:
            if (p["type"] == "high" and p["price"] >= cleaned[-1]["price"]) or \
               (p["type"] == "low" and p["price"] <= cleaned[-1]["price"]):
                cleaned[-1] = p
        else:
            cleaned.append(p)
    return cleaned


def classify_trend(sw):
    highs = [p for p in sw if p["type"] == "high"]
    lows = [p for p in sw if p["type"] == "low"]
    if len(highs) < 2 or len(lows) < 2:
        return "資料不足", "轉折點不足以判定"
    hh = highs[-1]["price"] > highs[-2]["price"]      # 頭頭高
    bh = lows[-1]["price"] > lows[-2]["price"]         # 底底高
    hl = highs[-1]["price"] < highs[-2]["price"]       # 頭頭低
    bl = lows[-1]["price"] < lows[-2]["price"]         # 底底低
    if hh and bh:
        return "多頭", "頭頭高 + 底底高"
    if hl and bl:
        return "空頭", "頭頭低 + 底底低"
    return "盤整", "高低點未同向（非多非空）"


def _anchors(sw, c, ma5, dates):
    """高檔量化錨點（進階連三紅第5/6點、淘汰法#5）：
    起漲達一倍＝高檔；沿5日均線累計漲幅>20% 出現變盤訊號→停利警戒；連漲3根以上勿追高。"""
    i = len(c) - 1
    out = {}
    lows_sw = [p for p in sw if p["type"] == "low"]
    if lows_sw:
        base = min(lows_sw, key=lambda p: p["price"])          # 波段大底（期間最低轉折低點）
        if base["price"] > 0:
            out["major_low_price"] = base["price"]
            out["major_low_date"] = dates[base["idx"]]
            out["rise_from_major_low_pct"] = round((c[i] - base["price"]) / base["price"] * 100, 2)
    # 沿5均上漲：今日往回，收盤持續 >= MA5（最多回看20根）的累計漲幅
    s = i
    while s > 0 and i - s < 20 and ma5[s] is not None and c[s] >= ma5[s]:
        s -= 1
    start = s + 1
    if start < i and ma5[i] is not None and c[i] >= ma5[i] and c[start] > 0 and c[i] > c[start]:
        out["ma5_run_days"] = i - start + 1
        out["ma5_run_rise_pct"] = round((c[i] - c[start]) / c[start] * 100, 2)
    # 連續上漲根數
    up = 0
    j = i
    while j > 0 and c[j] > c[j - 1]:
        up += 1
        j -= 1
    out["up_streak"] = up
    return out


def _key_levels(o, h, l, c, v, dates, lookback=20):
    """持股健檢價位。
    初階 CH3：大量長紅K三支撐——最高點（跌破＝攻擊減弱，3~5日內須站回）、
    1/2 價（跌破＝當日均成本失守、氣勢破壞）、最低點（跌破＝多空易位）。
    進階第三章：向上缺口四價位 上高價＞上沿價＞下沿價＞下底價，逐級失守意義遞增。"""
    n = len(c)
    out = {}
    # 近 lookback 日內最大量紅K
    s = max(0, n - lookback)
    best = None
    for j in range(s, n):
        if c[j] > o[j] and (best is None or v[j] > v[best]):
            best = j
    if best is not None and v[best] > 0:
        out["big_red_k"] = {
            "date": dates[best], "volume": v[best],
            "high": round(h[best], 2),                       # 跌破＝攻擊減弱，3~5日內須站回
            "half": round((h[best] + l[best]) / 2, 2),       # 跌破＝當日均成本失守
            "low": round(l[best], 2),                        # 跌破＝多空易位
        }
    # 未回補的向上跳空缺口（近60根內；完全回補＝之後任一日 low <= 缺口下沿）
    gaps = []
    for j in range(max(1, n - 60), n):
        if l[j] > h[j - 1]:
            bottom = h[j - 1]
            if not any(l[t] <= bottom for t in range(j, n)):
                gaps.append({
                    "date": dates[j],
                    "upper_high": round(h[j], 2),    # 上高價
                    "upper": round(l[j], 2),         # 上沿價
                    "lower": round(bottom, 2),       # 下沿價
                    "lower_low": round(l[j - 1], 2), # 下底價
                })
    if gaps:
        out["open_gaps_up"] = gaps[-3:]
    return out or None


def _retrace(sw, c, ma20, i):
    """回檔 1/2 法則（初階 CH2）：前波漲幅（前底→前高）與當前回檔比例。
    弱勢回檔 = 回檔 < 前波漲幅 1/2 且未破月線、未破前低 → 多頭續漲（回後買上漲正宗場景）；
    強勢回檔 = 超過 1/2 或跌破月線/前低 → 易頭頭低盤整，需站回月線再談做多。"""
    highs_sw = [p for p in sw if p["type"] == "high"]
    if not highs_sw:
        return None
    ph = highs_sw[-1]                                   # 最近轉折高（前高）
    lows_before = [p for p in sw if p["type"] == "low" and p["idx"] < ph["idx"]]
    if not lows_before:
        return None
    pl = lows_before[-1]                                # 前高之前最近轉折低（前底）
    up_amp = ph["price"] - pl["price"]
    pull_low = min(c[ph["idx"]:])                       # 前高以來最低收盤（含今日）
    if up_amp <= 0 or pull_low >= ph["price"]:
        return None
    pull_amp = ph["price"] - pull_low
    return {
        "prev_low": pl["price"], "prev_high": ph["price"],
        "prev_up_pct": round(up_amp / pl["price"] * 100, 2),      # 前波漲幅%
        "pullback_pct": round(pull_amp / ph["price"] * 100, 2),   # 當前回檔幅度%
        "ratio": round(pull_amp / up_amp, 2),                     # 回檔/前波漲幅；>0.5 即超過 1/2
        "below_ma20": bool(ma20[i] and c[i] < ma20[i]),
        "broke_prev_low": bool(pull_low < pl["price"]),
    }


# ---------------- 組裝 ----------------
def build(raw):
    meta = raw["meta"]
    ts = raw.get("timestamp", [])
    q = raw["indicators"]["quote"][0]
    o, h, l, c, v = q["open"], q["high"], q["low"], q["close"], q["volume"]
    # 清掉 None（停牌/缺值）
    rows = [(ts[i], o[i], h[i], l[i], c[i], v[i]) for i in range(len(ts))
            if None not in (o[i], h[i], l[i], c[i])]
    ts = [r[0] for r in rows]
    o = [r[1] for r in rows]; h = [r[2] for r in rows]
    l = [r[3] for r in rows]; c = [r[4] for r in rows]
    v = [int(r[5]) if r[5] else 0 for r in rows]
    import datetime
    dates = [datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%d") for t in ts]

    ma5, ma10, ma20, ma60 = sma(c, 5), sma(c, 10), sma(c, 20), sma(c, 60)
    vma5, vma10 = sma([float(x) for x in v], 5), sma([float(x) for x in v], 10)
    k_arr, d_arr = kd(h, l, c)
    dif, dea, hist = macd(c)
    sw = swings(c, ma5)
    # 轉成可讀（含日期），取最後 8 個
    sw_named = [{"type": p["type"], "date": dates[p["idx"]], "price": p["price"]} for p in sw][-8:]
    trend, trend_reason = classify_trend(sw)

    i = len(c) - 1
    last = lambda a: (round(a[i], 3) if a[i] is not None else None)
    prev_close = c[i-1] if i >= 1 else None
    change_pct = round((c[i] - prev_close) / prev_close * 100, 2) if prev_close else None
    vol_ratio = round(v[i] / v[i-1], 2) if i >= 1 and v[i-1] else None

    # 均線多排判定
    align = None
    if None not in (ma5[i], ma10[i], ma20[i]):
        if ma5[i] > ma10[i] > ma20[i]:
            align = "3線多排"
        elif ma60[i] is not None and ma5[i] > ma10[i] > ma20[i] > ma60[i]:
            align = "4線多排"
        elif ma5[i] < ma10[i] < ma20[i]:
            align = "3線空排"
        else:
            align = "糾結/不規則"
    slope = lambda a: ("上彎" if a[i] is not None and a[i-1] is not None and a[i] > a[i-1]
                       else "下彎" if a[i] is not None and a[i-1] is not None else None)

    return {
        "candles": {"date": dates, "open": o, "high": h, "low": l, "close": c, "volume": v},
        "latest": {
            "date": dates[i], "close": round(c[i], 2), "open": round(o[i], 2),
            "high": round(h[i], 2), "low": round(l[i], 2), "prev_close": prev_close,
            "change_pct": change_pct, "volume": v[i],
            "ma5": last(ma5), "ma10": last(ma10), "ma20": last(ma20), "ma60": last(ma60),
            "ma5_slope": slope(ma5), "ma10_slope": slope(ma10), "ma20_slope": slope(ma20),
            "ma_alignment": align,
            "price_vs_ma20": ("站上月線" if ma20[i] and c[i] > ma20[i] else "在月線下"),
            "vol_ma5": round(vma5[i]) if vma5[i] else None,
            "vol_ma10": round(vma10[i]) if vma10[i] else None,
            "vol_ratio_vs_prev": vol_ratio,
            # 攻擊量雙軌擇一（初階CH6）：>昨量×1.3 或 >基本量(前5日均量,不含今日)×1.2
            "vol_ratio_vs_base5": (round(v[i] / vma5[i-1], 2)
                                   if i >= 1 and vma5[i-1] else None),
            "is_attack_vol": ((vol_ratio is not None and vol_ratio >= ATTACK_VOL_RATIO)
                              or (i >= 1 and vma5[i-1] is not None and vma5[i-1] > 0
                                  and v[i] / vma5[i-1] >= ATTACK_VOL_BASE)),
            "k": last(k_arr), "d": last(d_arr),
            "kd_cross": ("黃金交叉" if k_arr[i] and d_arr[i] and k_arr[i] > d_arr[i]
                         and k_arr[i-1] and d_arr[i-1] and k_arr[i-1] <= d_arr[i-1]
                         else "死亡交叉" if k_arr[i] and d_arr[i] and k_arr[i] < d_arr[i]
                         and k_arr[i-1] and d_arr[i-1] and k_arr[i-1] >= d_arr[i-1]
                         else ("K>D 多排" if k_arr[i] and d_arr[i] and k_arr[i] > d_arr[i] else "K<D 空排")),
            "macd_dif": last(dif), "macd_dea": last(dea), "macd_hist": last(hist),
            "macd_hist_trend": ("紅柱延長" if hist[i] is not None and hist[i-1] is not None and hist[i] > hist[i-1] >= 0
                                else "綠柱縮短" if hist[i] is not None and hist[i-1] is not None and hist[i] > hist[i-1]
                                else "柱狀走弱" if hist[i] is not None and hist[i-1] is not None else None),
        },
        "swings": sw_named,
        "trend": trend, "trend_reason": trend_reason,
        "retrace": _retrace(sw, c, ma20, i),
        "position_anchors": _anchors(sw, c, ma5, dates),
        "key_levels": _key_levels(o, h, l, c, v, dates),
        "recent": [  # 最後 6 根 K 供 K 線型態判讀
            {"date": dates[j], "o": round(o[j], 2), "h": round(h[j], 2),
             "l": round(l[j], 2), "c": round(c[j], 2), "v": v[j],
             "chg%": round((c[j]-c[j-1])/c[j-1]*100, 2) if j >= 1 and c[j-1] else None}
            for j in range(max(0, len(c)-6), len(c))
        ],
    }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(json.dumps({"error": "用法: python fetch_stock.py <股號> (例 2330 / AAPL / 6488.TWO)"}, ensure_ascii=False))
        return
    sym = args[0]
    try:
        d_raw, resolved = fetch(sym, "1d", "1y")
        w_raw, _ = fetch(resolved, "1wk", "5y")
        meta = d_raw["meta"]
        out = {
            "symbol": resolved,
            "name": meta.get("longName") or meta.get("shortName") or resolved,
            "currency": meta.get("currency"),
            "market": ("台股" if resolved.endswith((".TW", ".TWO")) else "美股/其他"),
            "regularMarketPrice": meta.get("regularMarketPrice"),
            "daily": build(d_raw),
            "weekly": build(w_raw),
        }
        # 週線壓力空間（戒律3 資料化）：現價上方最近的週線轉折高點與距離%
        try:
            cur = out["daily"]["latest"]["close"]
            wk_highs = [p["price"] for p in out["weekly"]["swings"]
                        if p["type"] == "high" and p["price"] > cur]
            if wk_highs and cur:
                res = min(wk_highs)
                out["weekly_resistance"] = {
                    "price": res,
                    "distance_pct": round((res - cur) / cur * 100, 2),  # <5% 觸戒律3
                }
            else:
                out["weekly_resistance"] = None  # 現價之上無週線前高（創新高），無壓力
        except Exception:
            out["weekly_resistance"] = None
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e), "symbol": sym}, ensure_ascii=False))


if __name__ == "__main__":
    main()
