"""
batch_modules/indicators.py
==========================
STEP 2: ??? ?? ??
"""

import pandas as pd
import numpy as np
from datetime import datetime, date, timedelta
from supabase import Client
from .utils import safe_float, safe_int, to_iso, calculate_rsi, calculate_avwap


def calculate_indicators(supabase: Client, trading_date: str):
    """??? ?? ??"""
    trading_iso = to_iso(trading_date)
    print(f"\n[2/7] ??? ?? ??...")

    try:
        res = supabase.table("stock_daily") \
            .select("ticker").eq("date", trading_iso).execute()
        target_tickers = list(set(r["ticker"] for r in (res.data or [])))
    except Exception as e:
        print(f"  ? ?? ?? ?? ??: {e}")
        return

    if not target_tickers:
        print("   ?? ???? ?? ??? ????.")
        return

    print(f"  -> ?? ??: {len(target_tickers)}?")

    total_success = 0
    total_fail = 0
    upsert_buffer: list = []
    from_date = (date.today() - timedelta(days=400)).isoformat()

    def n(v):
        try:
            fv = float(v)
            return None if (pd.isna(fv) or np.isinf(fv)) else round(fv, 4)
        except:
            return None

    def n_int(v):
        try:
            fv = float(v)
            return None if (pd.isna(fv) or np.isinf(fv)) else int(fv)
        except:
            return None

    for idx, ticker in enumerate(target_tickers):
        if idx % 100 == 0:
            print(f"  -> ??: {idx}/{len(target_tickers)}")
            if upsert_buffer:
                try:
                    supabase.table("daily_indicators").upsert(upsert_buffer).execute()
                except Exception as e:
                    print(f"     upsert ??: {e}")
                upsert_buffer = []

        try:
            h_res = supabase.table("stock_daily") \
                .select("*") \
                .eq("ticker", ticker) \
                .gte("date", from_date) \
                .order("date", desc=False) \
                .limit(500).execute()

            if not h_res.data or len(h_res.data) < 20:
                continue

            df = pd.DataFrame(h_res.data)
            df["date"] = pd.to_datetime(df["date"])
            df = df.sort_values("date")

            close = df["close"].astype(float)
            df = df.copy()
            df["rsi14"] = calculate_rsi(close, 14)
            df["roc14"] = close.pct_change(14) * 100
            df["roc21"] = close.pct_change(21) * 100
            df["sma20"] = close.rolling(20).mean()
            df["sma50"] = close.rolling(50).mean()
            df["sma200"] = close.rolling(200).mean()
            df["slope200"] = df["sma200"].diff(5)

            avwap_val = None
            try:
                window = min(250, len(df))
                low_idx = df["low"].astype(float).tail(window).idxmin()
                idx_loc = df.index.get_loc(low_idx)
                avwap_val = calculate_avwap(
                    df.assign(close=df["close"].astype(float), volume=df["volume"].astype(float)),
                    idx_loc,
                )
            except:
                pass

            last = df.iloc[-1]
            last_date_str = last["date"].strftime("%Y-%m-%d")

            upsert_buffer.append({
                "code": ticker,
                "trade_date": last_date_str,
                "close": n(last["close"]),
                "volume": n_int(last.get("volume")),
                "value_traded": n(last.get("value")),
                "sma20": n(last.get("sma20")),
                "sma50": n(last.get("sma50")),
                "sma200": n(last.get("sma200")),
                "slope200": n(last.get("slope200")),
                "rsi14": n(last.get("rsi14")),
                "roc14": n(last.get("roc14")),
                "roc21": n(last.get("roc21")),
                "avwap_breakout": n(avwap_val) if avwap_val else None,
                "updated_at": datetime.now().isoformat(),
            })
            total_success += 1

        except Exception as e:
            total_fail += 1
            if total_fail <= 5:
                print(f"     {ticker}: {e}")
            continue

    if upsert_buffer:
        try:
            supabase.table("daily_indicators").upsert(upsert_buffer).execute()
        except Exception as e:
            print(f"     ?? upsert ??: {e}")

    print(f"   {total_success}? ?? ?? ?? ?? (??: {total_fail}?)")
    _sync_stocks_indicators(supabase, trading_date)


def _sync_stocks_indicators(supabase: Client, trading_date: str):
    """stocks ??? ?? ???"""
    trading_iso = to_iso(trading_date)
    print("  -> stocks ??? ?? ???...")
    try:
        res = supabase.table("stocks") \
            .select("code, name").in_("universe_level", ["core", "extended"]).execute()
        valid_stocks = {r["code"]: r["name"] for r in (res.data or []) if r.get("name")}
        codes = list(valid_stocks.keys())
        if not codes:
            return
        for i in range(0, len(codes), 50):
            batch_codes = codes[i:i+50]
            ind_res = supabase.table("daily_indicators") \
                .select("code, close, sma20, sma50, rsi14, roc14") \
                .in_("code", batch_codes) \
                .eq("trade_date", trading_iso).execute()
            updates = []
            for row in (ind_res.data or []):
                code = row["code"]
                if code not in valid_stocks:
                    continue
                updates.append({
                    "code": code,
                    "name": valid_stocks[code],
                    "close": safe_int(row.get("close")),
                    "sma20": safe_float(row.get("sma20")) if row.get("sma20") else None,
                    "rsi14": safe_float(row.get("rsi14")) if row.get("rsi14") else None,
                    "updated_at": datetime.now().isoformat(),
                })
            if updates:
                supabase.table("stocks").upsert(updates).execute()
        print(f"   stocks ?? ??? ?? ({len(codes)}?)")
    except Exception as e:
        print(f"   stocks ?? ??? ??: {e}")


