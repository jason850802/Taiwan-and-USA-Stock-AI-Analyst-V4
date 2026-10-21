#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_stock.py — 進場分析 Skills 共用資料來源
======================================================
抓取 Yahoo Finance 的日線 / 週線 OHLCV，計算朱家泓技術分析所需的
均線（含6線排列與移動扣抵）、量能、KD、MACD、布林通道、MA5轉折波（頭/底）、
趨勢判定、缺口（真/假封口）、大量紅黑K三價位與型態目標價，輸出單一 JSON。

用法:
    python fetch_stock.py 2330            # 台股，自動試 .TW 再 .TWO
    python fetch_stock.py AAPL            # 美股
    python fetch_stock.py 2330.TW --json  # 指定後綴
    python fetch_stock.py 6488.TWO

輸出: stdout 一段 JSON（給 skill 判讀）。失敗時輸出 {"error": "..."}。

指標參數（與講義實戰參數、App 端一致）:
    KD    : 5, 3, 3        (講義 KD 參數；App utils/math.ts calculateKDJ period=5)
    MACD  : 10, 20, 10     (講義 MACD 參數；App utils/math.ts calculateMACD 10,20,10)
    BBAND : 20, 2          (講義布林通道參數；MA20 ± 2個標準差)
"""
import sys, json, time, math, urllib.request, urllib.parse, ssl

# 強制 UTF-8 輸出（Windows 預設 cp950 會讓中文欄位亂碼/解碼失敗）
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ---------------- 參數設定 ----------------
KD_N, KD_K, KD_D = 5, 3, 3
MACD_FAST, MACD_SLOW, MACD_SIGNAL = 10, 20, 10
BB_PERIOD, BB_STD = 20, 2
SWING_K = 2              # 備援 fractal 視窗（當 MA5 轉折點不足時使用）
ATTACK_VOL_RATIO = 1.3   # 攻擊量門檻A（>昨日 1.3 倍）
ATTACK_VOL_BASE = 1.2    # 攻擊量門檻B（>基本量＝前5日均量 1.2 倍）；雙軌擇一成立即攻擊量
CANDLES_OUT = 250        # 輸出 candles 只留最後 N 根（日線抓 2y 是為了讓 MA240 有足夠前置資料，輸出不必全帶）
MAJOR_LOW_LOOKBACK = 60  # 波段大底搜尋窗（近 N 日內最低點，避免抓到過久遠的歷史低點）

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


def bbands(xs, n=BB_PERIOD, mult=BB_STD):
    """布林通道（進階第二章 2-3）：中軌 MA20，上下軌 ±2 個標準差。"""
    length = len(xs)
    upper = [None] * length
    mid = [None] * length
    lower = [None] * length
    if length < n:
        return upper, mid, lower
    for i in range(n - 1, length):
        seg = xs[i - n + 1 : i + 1]
        m = sum(seg) / n
        var = sum((x - m) ** 2 for x in seg) / n
        sd = math.sqrt(var)
        mid[i] = m
        upper[i] = m + mult * sd
        lower[i] = m - mult * sd
    return upper, mid, lower


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


def swings(close, ma5, high=None, low=None, k=SWING_K):
    """朱家泓 5 日均線短線轉折波取點原則（初階 CH2 p.17-24）：
    - 股價在 5 日均線上方行進，當收盤跌破 5 日均線時，往左邊 K 線取出最高點（含上影線 high）為「頭」；
    - 股價在 5 日均線下方行進，當收盤突破 5 日均線時，往左邊 K 線取出最低點（含下影線 low）為「底」。
    若未提供 high/low 則退回使用 close；若 MA5 轉折點不足則以高低價 fractal 補齊。"""
    h_arr = high if high is not None else close
    l_arr = low if low is not None else close
    n = len(close)
    pts = []

    # 找出第一個有 MA5 的位置
    start_idx = next((i for i in range(n) if ma5[i] is not None), None)
    if start_idx is not None and start_idx < n:
        state = "above" if close[start_idx] >= ma5[start_idx] else "below"
        seg_start = start_idx
        for i in range(start_idx + 1, n):
            if ma5[i] is None:
                continue
            now_above = close[i] >= ma5[i]
            if state == "above" and not now_above:
                # 收盤跌破 5 均 → 往左取本段最高點（含上影線，包含轉折當日若創高後收破）
                seg_end = i
                best_idx = max(range(seg_start, seg_end + 1), key=lambda idx: h_arr[idx])
                pts.append({"type": "high", "idx": best_idx, "price": round(h_arr[best_idx], 2)})
                state = "below"
                seg_start = i
            elif state == "below" and now_above:
                # 收盤突破 5 均 → 往左取本段最低點（含下影線，包含轉折當日若破低後收上）
                seg_end = i
                best_idx = min(range(seg_start, seg_end + 1), key=lambda idx: l_arr[idx])
                pts.append({"type": "low", "idx": best_idx, "price": round(l_arr[best_idx], 2)})
                state = "above"
                seg_start = i

    # 去除連續同型，保留更極端者
    cleaned = []
    for p in pts:
        if cleaned and cleaned[-1]["type"] == p["type"]:
            if (p["type"] == "high" and p["price"] >= cleaned[-1]["price"]) or \
               (p["type"] == "low" and p["price"] <= cleaned[-1]["price"]):
                cleaned[-1] = p
        else:
            cleaned.append(p)

    # 若 MA5 轉折點少於 4 個（例如資料太短或一路單邊未破 MA5），以含影線之 fractal 備援
    if len([p for p in cleaned if p["type"] == "high"]) < 2 or \
       len([p for p in cleaned if p["type"] == "low"]) < 2:
        f_pts = []
        for i in range(k, n - k):
            win_h = h_arr[i-k:i+k+1]
            win_l = l_arr[i-k:i+k+1]
            if h_arr[i] == max(win_h) and h_arr[i] > h_arr[i-1]:
                f_pts.append({"type": "high", "idx": i, "price": round(h_arr[i], 2)})
            elif l_arr[i] == min(win_l) and l_arr[i] < l_arr[i-1]:
                f_pts.append({"type": "low", "idx": i, "price": round(l_arr[i], 2)})
        cleaned = []
        for p in f_pts:
            if cleaned and cleaned[-1]["type"] == p["type"]:
                if (p["type"] == "high" and p["price"] >= cleaned[-1]["price"]) or \
                   (p["type"] == "low" and p["price"] <= cleaned[-1]["price"]):
                    cleaned[-1] = p
            else:
                cleaned.append(p)

    # 收斂已突破之 ABC 回檔修正次級波（進階 CH6-1 盤整突破 / CH6-4 突破 ABC 修正切線 / p.85 空轉多過空高）：
    # 當走勢出現 H_major -> L_mid -> H_minor -> L_last（其中 H_minor <= H_major 且 L_last <= L_mid，即回檔中繼小反彈），
    # 且後續上漲波已有效突破起跌高點 H_major 時，中間的 [L_mid, H_minor] 為同一段回檔修正之內部次級結構，收斂為單一波段底 L_last。
    # 收斂前須確保至少有 3 高 3 低，使收斂後仍保有至少 2 高 2 低（含 H_major 之前的前底 L_prev）可供比對。
    changed = True
    while (changed
           and len([p for p in cleaned if p["type"] == "high"]) >= 3
           and len([p for p in cleaned if p["type"] == "low"]) >= 3):
        changed = False
        # 1. 已確認轉折序列內部的 ABC 收斂
        for m in range(len(cleaned) - 4):
            p0, p1, p2, p3, p4 = cleaned[m], cleaned[m+1], cleaned[m+2], cleaned[m+3], cleaned[m+4]
            if (p0["type"] == "high" and p1["type"] == "low" and p2["type"] == "high"
                    and p3["type"] == "low" and p4["type"] == "high"):
                if p2["price"] <= p0["price"] and p3["price"] <= p1["price"] and p4["price"] > p0["price"]:
                    del cleaned[m+1:m+3]
                    changed = True
                    break
        if changed:
            continue
        # 2. 末端最後一個確認轉折為「底」L_last，且當前未結束之上漲波收盤與最高價已突破起跌高點 H_major
        if len(cleaned) >= 4 and cleaned[-1]["type"] == "low" and n > 0:
            p0, p1, p2, p3 = cleaned[-4], cleaned[-3], cleaned[-2], cleaned[-1]
            cur_c = close[-1]
            cur_h = max(h_arr[p3["idx"]:]) if p3["idx"] < n else h_arr[-1]
            if (p0["type"] == "high" and p1["type"] == "low" and p2["type"] == "high"
                    and p2["price"] <= p0["price"] and p3["price"] <= p1["price"]
                    and cur_c > p0["price"] and cur_h > p0["price"]):
                del cleaned[-3:-1]
                changed = True

    return cleaned


def _pending_swing(close, ma5, high, low, dates, sw):
    """計算最後一段尚未收盤跌破/突破 MA5 的『暫時高點 / 暫時低點』（初階 CH2 p.18）。"""
    n = len(close)
    if n == 0 or ma5[-1] is None:
        return None
    last_sw_idx = sw[-1]["idx"] if sw else 0
    if close[-1] >= ma5[-1]:
        best_idx = max(range(last_sw_idx, n), key=lambda idx: high[idx])
        return {"type": "pending_high", "date": dates[best_idx], "price": round(high[best_idx], 2)}
    else:
        best_idx = min(range(last_sw_idx, n), key=lambda idx: low[idx])
        return {"type": "pending_low", "date": dates[best_idx], "price": round(low[best_idx], 2)}


def classify_trend(sw, close=None, high=None, low=None):
    """依最近兩個確認轉折高（頭）與轉折低（底）判定趨勢，並結合當下價格是否已突破前高或跌破前低（初階 CH2 p.29, 33, 35）。"""
    highs = [p for p in sw if p["type"] == "high"]
    lows = [p for p in sw if p["type"] == "low"]
    if len(highs) < 2 or len(lows) < 2:
        return "資料不足", "轉折點不足以判定"

    h1, h2 = highs[-2]["price"], highs[-1]["price"]
    l1, l2 = lows[-2]["price"], lows[-1]["price"]

    # 若最後一個已確認轉折是「底」(lows[-1].idx > highs[-1].idx)，且目前最新收盤/最高價已創下高於 h2 的新高，
    # 代表新一段上漲波已經滿足「創新高（頭頭高）」！
    if close is not None and high is not None:
        cur_c = close[-1]
        cur_h = max(high[lows[-1]["idx"]:]) if lows[-1]["idx"] < len(high) else high[-1]
        if lows[-1]["idx"] > highs[-1]["idx"] and cur_c > h2 and cur_h > h2:
            h1, h2 = h2, round(cur_h, 2)
        # 同理，若最後一個確認轉折是「頭」，且最新收盤已跌破最近一個底 l2（出現底底低 → 多頭改變為盤整/空頭）
        if highs[-1]["idx"] > lows[-1]["idx"] and cur_c < l2:
            l1, l2 = l2, round(cur_c, 2)

    hh = h2 > h1  # 頭頭高
    bh = l2 > l1  # 底底高
    hl = h2 < h1  # 頭頭低
    bl = l2 < l1  # 底底低

    if hh and bh:
        return "多頭", f"頭頭高({h1}→{h2}) + 底底高({l1}→{l2})"
    if hl and bl:
        return "空頭", f"頭頭低({h1}→{h2}) + 底底低({l1}→{l2})"
    if hh and bl:
        return "盤整", f"頭頭高({h1}→{h2})但底底低({l1}→{l2}，回檔跌破前低轉盤整)"
    if hl and bh:
        return "盤整", f"頭頭低({h1}→{h2})但底底高({l1}→{l2}，收斂/未過前高轉盤整)"
    return "盤整", "高低點未同向（非多非空）"


def _anchors(sw, o, h, l, c, v, ma5, dates):
    """高檔量化錨點（進階連三紅第5/6點、淘汰法#5）：
    起漲達一倍＝高檔；沿5日均線累計漲幅>20% 出現變盤訊號→停利警戒；連漲3根以上勿追高。"""
    i = len(c) - 1
    out = {}
    win_start = max(0, len(c) - MAJOR_LOW_LOOKBACK)
    lows_win = [p for p in sw if p["type"] == "low" and p["idx"] >= win_start]
    if lows_win:
        base = min(lows_win, key=lambda p: p["price"])
        base_price, base_idx = base["price"], base["idx"]
    else:
        seg = l[win_start:]
        base_price = round(min(seg), 2)
        base_idx = win_start + seg.index(min(seg))
    if base_price > 0:
        out["major_low_price"] = base_price
        out["major_low_date"] = dates[base_idx]
        out["major_low_lookback_days"] = MAJOR_LOW_LOOKBACK
        out["rise_from_major_low_pct"] = round((c[i] - base_price) / base_price * 100, 2)
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


def _detect_kline_patterns(o, h, l, c, v, vma5, ma20, dates):
    """偵測進階班第一章與第六章之特殊 K 線組合與買賣秘笈。"""
    n = len(c)
    if n < 4:
        return []
    i = n - 1
    patterns = []

    # 1. 紅黑紅「多方夾擊」（進階 p.68）：前第2根紅K、前第1根黑K（不破紅K低點）、今日紅K收盤站回黑K高點或開高續攻
    if c[i-2] > o[i-2] and c[i-1] < o[i-1] and c[i] > o[i]:
        if l[i-1] >= l[i-2] and c[i] >= o[i-1]:
            patterns.append("紅黑紅多方夾擊")

    # 2. 黑紅黑「空方夾擊」（進階 p.71）：前第2根黑K、前第1根紅K（不過黑K高點）、今日黑K收盤跌破紅K低點
    if c[i-2] < o[i-2] and c[i-1] > o[i-1] and c[i] < o[i]:
        if h[i-1] <= h[i-2] and c[i] <= o[i-1]:
            patterns.append("黑紅黑空方夾擊")

    # 3. 多頭吞噬 / 長紅吞噬（進階 p.10）：昨日黑K、今日紅K實體包覆昨日黑K實體
    if c[i-1] < o[i-1] and c[i] > o[i] and c[i] >= o[i-1] and o[i] <= c[i-1]:
        patterns.append("長紅吞噬(看漲)")

    # 4. 空頭吞噬 / 長黑吞噬（進階 p.3）：昨日紅K、今日黑K實體包覆昨日紅K實體
    if c[i-1] > o[i-1] and c[i] < o[i] and o[i] >= c[i-1] and c[i] <= o[i-1]:
        patterns.append("長黑吞噬(看跌)")

    # 5. 大敵當前（進階 p.49, 62）：近3日皆留明顯上影線（未檢查量能與位置，是否放量、是否在高檔由 skill 判讀）
    upper_shadows_3 = all(
        (h[t] - max(o[t], c[t])) > abs(c[t] - o[t]) * 0.6 and (h[t] - max(o[t], c[t])) / c[t] > 0.015
        for t in (i-2, i-1, i)
    )
    if upper_shadows_3:
        patterns.append("連三上影線(大敵當前警戒)")

    # 6. K線橫盤突破（進階第六章 6-3 p.428）：
    # 在今日之前有連續 3~12 根 K 棒的收盤價都介於基準 K 棒的 [low, high] 之間，且今日中長紅 K 收盤突破基準 K 最高點
    chg_today = (c[i] - c[i-1]) / c[i-1] * 100 if c[i-1] else 0
    if c[i] > o[i] and chg_today > 2.0:
        for span in range(3, min(13, i)):
            base_idx = i - 1 - span
            bh, bl = h[base_idx], l[base_idx]
            inside = all(bl <= c[t] <= bh for t in range(base_idx + 1, i))
            if inside and c[i] > bh and h[i-1] <= bh * 1.01:
                patterns.append(f"K線橫盤突破(橫盤{span}日突破{round(bh, 2)})")
                break

    # 7. 連兩日大量被黑K跌破（進階 p.104 祕笈4）：前兩日皆爆大量（>5日均量1.5倍），今日黑K收盤跌破前兩日最低點（未檢查是否在高檔，位置由 skill 判讀）
    if vma5[i-2] and vma5[i-1] and v[i-2] > vma5[i-2] * 1.5 and v[i-1] > vma5[i-1] * 1.5:
        two_day_low = min(l[i-2], l[i-1])
        if c[i] < o[i] and c[i] < two_day_low:
            patterns.append(f"高檔連兩日大量低點({round(two_day_low, 2)})被黑K跌破(一日反轉警訊)")

    return patterns


def _key_levels(o, h, l, c, v, dates, sw, lookback=20):
    """持股健檢與關鍵支撐壓力價位。
    - 初階 CH3 p.109-110：大量長紅K三支撐——最高點、1/2價、最低點。
    - 初階 CH3 p.134-135 & 進階 p.88：大量長黑K三壓力——最低點、1/2價、最高點（突破最高點＝多空易位買點）。
    - 進階第三章 p.272-295：向上/向下缺口四價位，並區分『真封口（收盤回補）』與『假封口（下影線刺穿但收盤守住）』。
    - 進階第一章/第四章/第六章：型態頸線與 ABC 等浪目標價量測。"""
    n = len(c)
    out = {}
    s = max(0, n - lookback)

    # 1. 近 lookback 日內最大量紅K（三道支撐）
    best_red = None
    for j in range(s, n):
        if c[j] > o[j] and (best_red is None or v[j] > v[best_red]):
            best_red = j
    if best_red is not None and v[best_red] > 0:
        rh, rl = round(h[best_red], 2), round(l[best_red], 2)
        rhalf = round((h[best_red] + l[best_red]) / 2, 2)
        cur = c[-1]
        status = ("站穩最高點之上(強勢)" if cur >= rh
                  else "跌破最高點、守1/2價之上(攻擊減弱)" if cur >= rhalf
                  else "跌破1/2價、守最低點之上(氣勢破壞)" if cur >= rl
                  else "跌破最低點(多空易位轉空)")
        out["big_red_k"] = {
            "date": dates[best_red], "volume": v[best_red],
            "high": rh, "half": rhalf, "low": rl,
            "current_status": status,
        }

    # 2. 近 lookback 日內最大量黑K（三道壓力；突破最高點＝多空易位買訊，進階 p.88 祕笈6）
    best_blk = None
    for j in range(s, n):
        if c[j] < o[j] and (best_blk is None or v[j] > v[best_blk]):
            best_blk = j
    if best_blk is not None and v[best_blk] > 0:
        bh, bl = round(h[best_blk], 2), round(l[best_blk], 2)
        bhalf = round((h[best_blk] + l[best_blk]) / 2, 2)
        cur = c[-1]
        status = ("收盤突破大量黑K最高點(多空易位轉多)" if cur > bh
                  else "突破1/2價、未過最高點(空方氣勢變化)" if cur >= bhalf
                  else "突破最低點、未過1/2價(下殺減弱)" if cur >= bl
                  else "在大量黑K最低點之下(空方壓制)")
        out["big_black_k"] = {
            "date": dates[best_blk], "volume": v[best_blk],
            "high": bh, "half": bhalf, "low": bl,
            "current_status": status,
            "broke_high_today": bool(best_blk < n - 1 and c[-2] <= bh and cur > bh),
        }

    # 3. 向上跳空缺口（近 60 根內；區分未回補 vs 假封口 vs 真封口）
    # 講義進階 p.290-295：收盤價跌到或跌破缺口下沿才算「真封口（支撐消失）」；盤中下影線觸及但收盤守住為「假封口（支撐有效）」。
    gaps_up = []
    for j in range(max(1, n - 60), n):
        if l[j] > h[j - 1]:
            bottom = h[j - 1]
            top = l[j]
            true_filled = any(c[t] <= bottom for t in range(j + 1, n))
            if not true_filled:
                false_filled = any(l[t] <= bottom and c[t] > bottom for t in range(j + 1, n))
                entered_zone = any(c[t] < top and c[t] > bottom for t in range(j + 1, n))
                fill_status = ("假封口(下影線測試下沿有撐)" if false_filled
                               else "進入缺口區間震盪(未真封口)" if entered_zone
                               else "完整未回補(強勢支撐)")
                gaps_up.append({
                    "date": dates[j],
                    "upper_high": round(h[j], 2),    # 上高價（最強支撐）
                    "upper": round(top, 2),          # 上沿價（次強支撐）
                    "lower": round(bottom, 2),       # 下沿價（弱支撐/真封口線）
                    "lower_low": round(l[j - 1], 2), # 下底價（跌破則多空易位）
                    "fill_status": fill_status,
                })
    if gaps_up:
        out["open_gaps_up"] = gaps_up[-3:]

    # 4. 向下跳空缺口（近 60 根內尚未被『收盤突破缺口上沿』真封口之上方缺口壓力）
    gaps_down = []
    for j in range(max(1, n - 60), n):
        if h[j] < l[j - 1]:
            top = l[j - 1]   # 缺口上沿
            bottom = h[j]    # 缺口下沿
            true_filled = any(c[t] >= top for t in range(j + 1, n))
            if not true_filled:
                gaps_down.append({
                    "date": dates[j],
                    "upper_high": round(h[j - 1], 2), # 上高價（突破則空翻多）
                    "upper": round(top, 2),           # 上沿價（真封口壓力線）
                    "lower": round(bottom, 2),        # 下沿價（次強壓力）
                    "lower_low": round(l[j], 2),      # 下底價（最強壓力）
                })
    if gaps_down:
        out["open_gaps_down"] = gaps_down[-3:]

    # 5. 目標價量測（進階 p.65 ABC 等浪目標價、p.81/452 底部型態一倍幅目標價）
    highs_sw = [p for p in sw if p["type"] == "high"]
    lows_sw = [p for p in sw if p["type"] == "low"]
    targets = {}
    if len(highs_sw) >= 1 and len(lows_sw) >= 2:
        ph = highs_sw[-1]
        lows_before = [p for p in lows_sw if p["idx"] < ph["idx"]]
        lows_after = [p for p in lows_sw if p["idx"] > ph["idx"]]
        if lows_before:
            pl = lows_before[-1]
            wave_d = round(ph["price"] - pl["price"], 2)
            # 若高點後已有回檔低點 C，則 ABC/N字等浪目標價 = C + D；否則以近期回檔最低點暫估。
            # C 跌破前底 A 已是底底低（非 N 字），等浪量測不成立，不輸出。
            c_low = lows_after[-1]["price"] if lows_after else round(min(l[ph["idx"]:]), 2)
            if wave_d > 0 and c_low > pl["price"]:
                targets["equal_wave_d"] = wave_d
                targets["abc_or_n_wave_target"] = round(c_low + wave_d, 2)
                targets["abc_c_confirmed"] = bool(lows_after)  # False＝C 點尚未收盤突破 MA5 確認，僅暫估
        # 頸線突破一倍幅目標價：頸線取最近轉折高，須今日收盤已站上頸線才量測（未突破＝型態未確認，只列頸線）
        win_start = max(0, n - MAJOR_LOW_LOOKBACK)
        major_low = round(min(l[win_start:]), 2)
        neckline = ph["price"]
        if neckline > major_low:
            targets["pattern_neckline"] = neckline
            targets["pattern_measured_target"] = (round(neckline + (neckline - major_low), 2)
                                                  if c[-1] > neckline else None)
    if targets:
        out["target_prices"] = targets

    return out or None


def _retrace(sw, h, l, c, ma20, i):
    """回檔 1/2 法則（初階 CH2 p.74-75）：前波漲幅（前底→前高）與當前回檔比例。
    - 弱勢回檔 = 回檔 < 前波漲幅 1/2 且未破月線、未破前低 → 多頭續漲（回後買上漲正宗場景）；
    - 強勢回檔 = 超過 1/2 或跌破月線/前低 → 易頭頭低盤整，需站回月線再談做多。"""
    highs_sw = [p for p in sw if p["type"] == "high"]
    lows_sw = [p for p in sw if p["type"] == "low"]
    if not highs_sw or not lows_sw:
        return None
    ph = highs_sw[-1]                                   # 最近轉折高（前高，含上影線）
    last_low = lows_sw[-1]

    # 若最後一個確認轉折是「底」(last_low.idx > ph.idx)，且在今日之前就已經收盤突破前高 ph，
    # 代表舊回檔早已結束、目前已處於自 last_low 起算的新一波段，應以新波段最高點衡量當前回檔。
    if last_low["idx"] > ph["idx"] and last_low["idx"] < i and max(c[last_low["idx"]:i]) > ph["price"]:
        pl = last_low
        peak_idx = max(range(pl["idx"], i + 1), key=lambda idx: h[idx])
        peak_price = round(h[peak_idx], 2)
        up_amp = peak_price - pl["price"]
        if up_amp <= 0:
            return None
        if peak_idx < i:
            pull_low_intraday = min(l[peak_idx + 1 : i + 1])
            pull_low_close = min(c[peak_idx + 1 : i + 1])
        else:
            pull_low_intraday = c[i]
            pull_low_close = c[i]
        if pull_low_intraday >= peak_price:
            return None
        pull_amp = peak_price - pull_low_intraday
        return {
            "prev_low": pl["price"], "prev_high": peak_price,
            "prev_up_pct": round(up_amp / pl["price"] * 100, 2),
            "pullback_low": round(pull_low_intraday, 2),
            "pullback_pct": round(pull_amp / peak_price * 100, 2),
            "ratio": round(pull_amp / up_amp, 2),
            "below_ma20": bool(ma20[i] and c[i] < ma20[i]),
            "broke_prev_low": bool(pull_low_close < pl["price"]),
            "broke_prev_low_intraday": bool(pull_low_intraday < pl["price"]),
        }

    lows_before = [p for p in lows_sw if p["idx"] < ph["idx"]]
    if not lows_before:
        return None
    pl = lows_before[-1]                                # 前高之前最近轉折低（前底，含下影線）
    up_amp = ph["price"] - pl["price"]
    pull_low_intraday = min(l[ph["idx"]:])              # 前高以來盤中最低點
    pull_low_close = min(c[ph["idx"]:])                 # 前高以來最低收盤價
    if up_amp <= 0 or pull_low_intraday >= ph["price"]:
        return None
    pull_amp = ph["price"] - pull_low_intraday
    return {
        "prev_low": pl["price"], "prev_high": ph["price"],
        "prev_up_pct": round(up_amp / pl["price"] * 100, 2),      # 前波漲幅%
        "pullback_low": round(pull_low_intraday, 2),
        "pullback_pct": round(pull_amp / ph["price"] * 100, 2),   # 當前回檔幅度%
        "ratio": round(pull_amp / up_amp, 2),                     # 回檔/前波漲幅；>0.5 即超過 1/2
        "below_ma20": bool(ma20[i] and c[i] < ma20[i]),
        "broke_prev_low": bool(pull_low_close < pl["price"]),     # 收盤跌破前低確認（觸犯戒律5）
        "broke_prev_low_intraday": bool(pull_low_intraday < pl["price"]),
    }


# ---------------- 組裝 ----------------
def build(raw):
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
    ma120, ma240 = sma(c, 120), sma(c, 240)
    vma5, vma10 = sma([float(x) for x in v], 5), sma([float(x) for x in v], 10)
    k_arr, d_arr = kd(h, l, c)
    dif, dea, hist = macd(c)
    bb_up, bb_mid, bb_low = bbands(c)
    sw = swings(c, ma5, h, l)
    # 轉成可讀（含日期），取最後 8 個
    sw_named = [{"type": p["type"], "date": dates[p["idx"]], "price": p["price"]} for p in sw][-8:]
    pending_sw = _pending_swing(c, ma5, h, l, dates, sw)
    trend, trend_reason = classify_trend(sw, c, h, l)

    i = len(c) - 1
    last = lambda a: (round(a[i], 3) if a[i] is not None else None)
    prev_close = c[i-1] if i >= 1 else None
    change_pct = round((c[i] - prev_close) / prev_close * 100, 2) if prev_close else None
    vol_ratio = round(v[i] / v[i-1], 2) if i >= 1 and v[i-1] else None

    # 均線多排判定（修正順序：由最嚴格的 6線 → 4線 → 3線 依序判斷）
    align = None
    if None not in (ma5[i], ma10[i], ma20[i]):
        if None not in (ma60[i], ma120[i], ma240[i]) and ma5[i] > ma10[i] > ma20[i] > ma60[i] > ma120[i] > ma240[i]:
            align = "6線多排"
        elif ma60[i] is not None and ma5[i] > ma10[i] > ma20[i] > ma60[i]:
            align = "4線多排"
        elif ma5[i] > ma10[i] > ma20[i]:
            align = "3線多排"
        elif None not in (ma60[i], ma120[i], ma240[i]) and ma5[i] < ma10[i] < ma20[i] < ma60[i] < ma120[i] < ma240[i]:
            align = "6線空排"
        elif ma60[i] is not None and ma5[i] < ma10[i] < ma20[i] < ma60[i]:
            align = "4線空排"
        elif ma5[i] < ma10[i] < ma20[i]:
            align = "3線空排"
        else:
            align = "糾結/不規則"

    slope = lambda a: ("上彎" if a[i] is not None and a[i-1] is not None and a[i] > a[i-1]
                       else "下彎" if a[i] is not None and a[i-1] is not None else None)

    # 移動扣抵（初階 CH4-2 p.148-156）：明日將扣除的第 N 天前收盤價
    ma_deduction = {}
    if i >= 4:
        ma_deduction["ma5_deduct_price"] = round(c[i - 4], 2)
    if i >= 9:
        ma_deduction["ma10_deduct_price"] = round(c[i - 9], 2)
    if i >= 19:
        d20_now = round(c[i - 19], 2)
        d20_next5 = [round(c[t], 2) for t in range(max(0, i - 19), min(len(c), i - 14))]
        ma_deduction["ma20_deduct_price"] = d20_now
        ma_deduction["ma20_deduct_next5d"] = d20_next5
        ma_deduction["ma20_deduct_effect"] = (
            "扣低抵高(助漲月線上揚)" if c[i] > max(d20_next5)
            else "扣高抵低(月線有下彎壓力)" if c[i] < min(d20_next5)
            else "扣抵區間震盪(月線走平或緩變)"
        )

    # K棒實體與影線（初階 CH3 & 進階 CH6「價漲、量增、線實」）
    body = c[i] - o[i]
    upper_sh = h[i] - max(o[i], c[i])
    lower_sh = min(o[i], c[i]) - l[i]
    body_pct = round(body / prev_close * 100, 2) if prev_close else 0.0
    upper_sh_pct = round(upper_sh / prev_close * 100, 2) if prev_close else 0.0
    lower_sh_pct = round(lower_sh / prev_close * 100, 2) if prev_close else 0.0
    # 線實紅K：收紅(c > o)、漲幅 > 2%、實體幅度 >= 1.5% 且上影線不超過實體長度（上影線比實體長＝長上影線壓頂）
    is_solid_red_k = bool(c[i] > o[i] and change_pct is not None and change_pct > 2.0
                          and body_pct >= 1.5 and upper_sh <= body)

    # 攻擊量雙軌擇一（初階CH6）：>昨量×1.3 或 >基本量(前5日均量,不含今日)×1.2
    is_attack_vol = bool((vol_ratio is not None and vol_ratio >= ATTACK_VOL_RATIO)
                         or (i >= 1 and vma5[i-1] is not None and vma5[i-1] > 0
                             and v[i] / vma5[i-1] >= ATTACK_VOL_BASE))

    # KD 狀態與進階 p.193「K值向上 / KD多排 / KD黃金交叉 三擇一」檢核
    k_slope = ("向上" if i >= 1 and k_arr[i] is not None and k_arr[i-1] is not None and k_arr[i] > k_arr[i-1]
               else "向下" if i >= 1 and k_arr[i] is not None and k_arr[i-1] is not None else None)
    kd_cross_str = ("黃金交叉" if k_arr[i] and d_arr[i] and k_arr[i] > d_arr[i]
                    and k_arr[i-1] and d_arr[i-1] and k_arr[i-1] <= d_arr[i-1]
                    else "死亡交叉" if k_arr[i] and d_arr[i] and k_arr[i] < d_arr[i]
                    and k_arr[i-1] and d_arr[i-1] and k_arr[i-1] >= d_arr[i-1]
                    else ("K>D 多排" if k_arr[i] and d_arr[i] and k_arr[i] > d_arr[i] else "K<D 空排"))
    kd_passivating = None
    if i >= 2 and all(k_arr[t] is not None and k_arr[t] >= 80 for t in (i-2, i-1, i)):
        kd_passivating = "高檔鈍化(連3日K>=80，回歸價量)"
    elif i >= 2 and all(k_arr[t] is not None and k_arr[t] <= 20 for t in (i-2, i-1, i)):
        kd_passivating = "低檔鈍化(連3日K<=20)"
    # 進階 p.193 & p.195 台燿範例：K值向上、KD多排(K>D)、KD黃金交叉 符合其一即可；KD 空排且 K 未向上則不進場。
    # 與 App utils/entryFilter.ts 步驟6 同一套：K、D 皆 >80（高檔鈍化）時指標失效，改看價量（價漲＋攻擊量才通過）。
    k_i, d_i = k_arr[i], d_arr[i]
    kd_blunt = k_i is not None and d_i is not None and k_i > 80 and d_i > 80
    if kd_blunt:
        kd_long_ok = bool(change_pct is not None and change_pct > 0 and is_attack_vol)
    else:
        kd_long_ok = bool(
            kd_cross_str == "黃金交叉"
            or (k_i is not None and d_i is not None and k_i > d_i)
            or (k_slope == "向上" and kd_cross_str != "死亡交叉")
        )

    # 布林通道狀態（進階 CH2-3 p.165-188）
    bb_status = None
    bb_width_pct = None
    if None not in (bb_up[i], bb_mid[i], bb_low[i]) and bb_mid[i] > 0:
        bb_width_pct = round((bb_up[i] - bb_low[i]) / bb_mid[i] * 100, 2)
        up_s, mid_s, low_s = slope(bb_up), slope(bb_mid), slope(bb_low)
        if up_s == "上彎" and mid_s == "上彎" and low_s == "上彎":
            bb_status = "三軌同時向上(強勢多頭)"
        elif up_s == "下彎" and mid_s == "下彎" and low_s == "下彎":
            bb_status = "三軌同時向下(弱勢空頭)"
        elif (up_s == "上彎" and low_s == "下彎" and c[i] > o[i] and is_attack_vol
              and i >= 5 and bb_up[i-1] is not None and c[i] >= bb_up[i-1]
              and None not in (bb_up[i-5], bb_low[i-5], bb_mid[i-5]) and bb_mid[i-5] > 0
              and bb_width_pct > (bb_up[i-5] - bb_low[i-5]) / bb_mid[i-5] * 100):
            # 進階 p.181：帶量紅K收盤突破上軌、上下軌反向張開且帶寬較 5 日前擴大，才算打開喇叭口
            bb_status = "喇叭開口向上張開(波段發動)"
        elif up_s == "下彎" and mid_s == "上彎" and low_s == "上彎":
            bb_status = "通道縮小、中下軌向上(多頭回檔強勢整理)"
        elif bb_width_pct < 8.0:
            bb_status = "布林通道水平收斂(等待突破表態)"
        elif c[i] >= bb_mid[i]:
            bb_status = "中軌與上軌之間運行(偏多)"
        else:
            bb_status = "中軌與下軌之間運行(偏空)"

    return {
        "candles": {"date": dates[-CANDLES_OUT:], "open": o[-CANDLES_OUT:], "high": h[-CANDLES_OUT:],
                    "low": l[-CANDLES_OUT:], "close": c[-CANDLES_OUT:], "volume": v[-CANDLES_OUT:]},
        "latest": {
            "date": dates[i], "close": round(c[i], 2), "open": round(o[i], 2),
            "high": round(h[i], 2), "low": round(l[i], 2), "prev_close": round(prev_close, 2) if prev_close else None,
            "change_pct": change_pct, "volume": v[i],
            "body_pct": body_pct, "upper_shadow_pct": upper_sh_pct, "lower_shadow_pct": lower_sh_pct,
            "is_solid_red_k": is_solid_red_k,
            "ma5": last(ma5), "ma10": last(ma10), "ma20": last(ma20), "ma60": last(ma60),
            "ma120": last(ma120), "ma240": last(ma240),
            "ma5_slope": slope(ma5), "ma10_slope": slope(ma10), "ma20_slope": slope(ma20), "ma60_slope": slope(ma60),
            "ma_alignment": align,
            "ma_deduction": ma_deduction,
            "price_vs_ma20": ("站上月線" if ma20[i] and c[i] > ma20[i] else "在月線下"),
            "vol_ma5": round(vma5[i]) if vma5[i] else None,
            "vol_ma10": round(vma10[i]) if vma10[i] else None,
            "vol_ratio_vs_prev": vol_ratio,
            "vol_ratio_vs_base5": (round(v[i] / vma5[i-1], 2)
                                   if i >= 1 and vma5[i-1] else None),
            "is_attack_vol": is_attack_vol,
            "k": last(k_arr), "d": last(d_arr),
            "k_slope": k_slope,
            "kd_cross": kd_cross_str,
            "kd_passivating": kd_passivating,
            "kd_long_ok": kd_long_ok,
            "macd_dif": last(dif), "macd_dea": last(dea), "macd_hist": last(hist),
            "macd_hist_trend": ("紅柱延長" if hist[i] is not None and hist[i-1] is not None and hist[i] > hist[i-1] >= 0
                                else "綠柱縮短" if hist[i] is not None and hist[i-1] is not None and hist[i] > hist[i-1]
                                else "紅柱縮短" if hist[i] is not None and hist[i-1] is not None and 0 <= hist[i] <= hist[i-1]
                                else "綠柱延長" if hist[i] is not None and hist[i-1] is not None else None),
            "bb_upper": last(bb_up), "bb_mid": last(bb_mid), "bb_lower": last(bb_low),
            "bb_width_pct": bb_width_pct, "bb_status": bb_status,
            "kline_patterns": _detect_kline_patterns(o, h, l, c, v, vma5, ma20, dates),
        },
        "swings": sw_named,
        "pending_swing": pending_sw,
        "trend": trend, "trend_reason": trend_reason,
        "retrace": _retrace(sw, h, l, c, ma20, i),
        "position_anchors": _anchors(sw, o, h, l, c, v, ma5, dates),
        "key_levels": _key_levels(o, h, l, c, v, dates, sw),
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
        d_raw, resolved = fetch(sym, "1d", "2y")
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
