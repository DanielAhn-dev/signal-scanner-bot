"""
batch_modules/signals.py
=======================
STEP 6: ??? ?? ??? ??
"""

import pandas as pd
import numpy as np
from datetime import datetime, date, timedelta
from typing import Optional, Dict
from supabase import Client
from .utils import safe_float, calculate_rsi, to_iso


def compute_pullback_signal(rows: list) -> dict:
    """Compute pullback signal grades from OHLCV history."""
    if len(rows) < 21:
        return {}

    df = pd.DataFrame(rows)
    df["close"] = df["close"].astype(float)
    df["high"] = df["high"].astype(float)
    df["low"] = df["low"].astype(float)
    df["volume"] = df["volume"].astype(float)

    closes = df["close"].values
    highs = df["high"].values
    lows = df["low"].values
    volumes = df["volume"].values
    n = len(closes)

    # Moving averages
    ma21 = np.mean(closes[-21:]) if n >= 21 else closes[-1]
    ma50 = np.mean(closes[-50:]) if n >= 50 else ma21
    c = closes[-1]

    # Distance from MA21
    dist = (c - ma21) / ma21 * 100 if ma21 > 0 else 0

    # Pivot/high zones
    pivot_low_10 = np.min(lows[-10:]) if n >= 10 else lows[-1]
    high_5 = np.max(highs[-5:]) if n >= 5 else highs[-1]

    # Volume baseline
    vol_sma20 = np.mean(volumes[-20:]) if n >= 20 else volumes[-1]

    # ATR14
    trs = []
    for i in range(max(1, n - 14), n):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1])
        )
        trs.append(tr)
    atr14 = np.mean(trs) if trs else 0.0

    # ATR SMA20 baseline
    if n >= 34:
        atr_series = []
        for j in range(max(14, n - 20), n):
            local_trs = []
            for k in range(max(1, j - 13), j + 1):
                tr = max(
                    highs[k] - lows[k],
                    abs(highs[k] - closes[k - 1]),
                    abs(lows[k] - closes[k - 1])
                )
                local_trs.append(tr)
            atr_series.append(np.mean(local_trs))
        atr_sma20 = np.mean(atr_series)
    else:
        atr_sma20 = atr14

    # RSI14
    rsi_series = calculate_rsi(pd.Series(closes), 14)
    rsi14 = float(rsi_series.iloc[-1]) if not pd.isna(rsi_series.iloc[-1]) else 50.0

    # Entry grading
    trend_aligned = ma21 > ma50 and c > ma21
    trend_grade = "A" if trend_aligned else ("B" if ma21 > ma50 else "C")

    dist_ok = -3 < dist < 5
    dist_grade = "A" if (-1 < dist < 3) else ("B" if dist_ok else "C")

    near_pivot = c <= pivot_low_10 * 1.03
    below_high = c < high_5
    pivot_grade = "A" if (near_pivot and below_high) else ("B" if (near_pivot or below_high) else "C")

    vol_dry = volumes[-1] < vol_sma20
    atr_ok = atr14 < atr_sma20
    vol_atr_grade = "A" if (vol_dry and atr_ok) else ("B" if (vol_dry or atr_ok) else "C")

    entry_score = sum([
        1 if trend_aligned else 0,
        1 if dist_ok else 0,
        1 if (near_pivot and below_high) else 0,
        1 if (vol_dry and atr_ok) else 0,
    ])
    entry_grade = "A" if entry_score >= 3 else ("B" if entry_score == 2 else "C")

    # Warning grading
    warn_overheat = dist > 7
    warn_vol_spike = volumes[-1] > vol_sma20 * 2
    warn_atr_spike = atr14 > atr_sma20 * 1.5
    warn_rsi_ob = rsi14 > 70
    warn_ma_break = c < ma21
    warn_dead_cross = ma21 < ma50

    warn_score = sum([
        1 if warn_overheat else 0,
        1 if warn_vol_spike else 0,
        1 if warn_atr_spike else 0,
        1 if warn_rsi_ob else 0,
        1 if warn_ma_break else 0,
        1 if warn_dead_cross else 0,
    ])
    warn_grade = "SELL" if warn_score >= 3 else ("WARN" if warn_score == 2 else ("WATCH" if warn_score == 1 else "SAFE"))

    return {
        "entry_grade": entry_grade,
        "entry_score": int(entry_score),
        "trend_grade": trend_grade,
        "dist_grade": dist_grade,
        "dist_pct": round(float(dist), 2),
        "pivot_grade": pivot_grade,
        "vol_atr_grade": vol_atr_grade,
        "warn_grade": warn_grade,
        "warn_score": int(warn_score),
        "warn_overheat": bool(warn_overheat),
        "warn_vol_spike": bool(warn_vol_spike),
        "warn_atr_spike": bool(warn_atr_spike),
        "warn_rsi_ob": bool(warn_rsi_ob),
        "warn_ma_break": bool(warn_ma_break),
        "warn_dead_cross": bool(warn_dead_cross),
        "ma21": round(float(ma21), 0),
        "ma50": round(float(ma50), 0),
    }


def save_pullback_signals(supabase: Client, trading_date: str):
    """Generate and store pullback signals."""
    trading_iso = to_iso(trading_date)
    print(f"\n[6/7] Generating pullback signals...")

    try:
        res = supabase.table("stocks") \
            .select("code") \
            .in_("universe_level", ["core", "extended"]).execute()
        codes = [s["code"] for s in (res.data or [])]
        if not codes:
            print("   No stocks found")
            return

        from_date_hist = (date.today() - timedelta(days=100)).isoformat()
        upserts = []
        fail_count = 0

        for idx, code in enumerate(codes):
            try:
                h_res = supabase.table("stock_daily") \
                    .select("date, open, high, low, close, volume, value") \
                    .eq("ticker", code) \
                    .gte("date", from_date_hist) \
                    .order("date", desc=False) \
                    .limit(100).execute()
                if h_res.data and len(h_res.data) >= 21:
                    sig = compute_pullback_signal(h_res.data)
                    if sig:
                        upserts.append({
                            "code": code,
                            "trade_date": trading_iso,
                            **sig,
                        })
            except:
                fail_count += 1

            if (idx + 1) % 100 == 0:
                print(f"  -> progress: {idx + 1}/{len(codes)}")

        print(f"  -> computed {len(upserts)} signals (fail: {fail_count})")

        if upserts:
            for i in range(0, len(upserts), 200):
                batch = upserts[i:i+200]
                try:
                    supabase.table("pullback_signals").upsert(batch).execute()
                except Exception as e:
                    print(f"   pullback_signals upsert error: {e}")
                    for j in range(0, len(batch), 50):
                        try:
                            supabase.table("pullback_signals").upsert(batch[j:j+50]).execute()
                        except:
                            pass
            print(f"   stored {len(upserts)} pullback_signals rows")

    except Exception as e:
        print(f"  pullback signal generation failed: {e}")
        import traceback
        traceback.print_exc()


