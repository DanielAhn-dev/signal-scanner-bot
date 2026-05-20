"""
batch_modules/ohlcv.py
=====================
STEP 1: DB ?? ?? OHLCV ??
"""

import time
from datetime import datetime, timedelta, date
from typing import Optional
from supabase import Client
from pykrx import stock
from .utils import safe_float, safe_int, to_iso


def fetch_ohlcv_per_ticker(supabase: Client, trading_date: str) -> bool:
    """Fetch OHLCV for core/extended universe using per-ticker API."""
    trading_iso = to_iso(trading_date)
    print(f"\n[1/7] OHLCV collection (per-ticker API, target: {trading_date})...")

    # Current latest stock_daily date in DB
    latest_res = supabase.table("stock_daily") \
        .select("date").order("date", desc=True).limit(1).execute()
    latest_date = latest_res.data[0]["date"] if latest_res.data else "2025-01-01"
    latest_dt = datetime.strptime(latest_date, "%Y-%m-%d").date()
    trading_dt = datetime.strptime(trading_date, "%Y%m%d").date()
    
    print(f"  DB latest stock_daily: {latest_date} (target: {trading_date})")
    
    # If gap is too large, reset table for safe recovery
    days_gap = (trading_dt - latest_dt).days
    if days_gap > 30:
        print(f"   Warning: DB gap is {days_gap} days (latest: {latest_date}, target: {trading_date})")
        print(f"   Reinitializing stock_daily and rebuilding a recent 180-day window...")
        try:
            supabase.table("stock_daily").delete().gte("date", "2000-01-01").execute()
            latest_date = "2025-01-01"
            print(f"   stock_daily table reset complete")
        except Exception as e:
            print(f"   Reset failed: {e}, continuing without reset...")

    from_dt = datetime.strptime(latest_date, "%Y-%m-%d") + timedelta(days=1)
    
    cutoff_dt = trading_dt - timedelta(days=180)
    if from_dt.date() < cutoff_dt:
        from_dt = datetime.combine(cutoff_dt, datetime.min.time())
        print(f"   Capping start date to recent 180-day window: {from_dt.date()}")
    
    from_str = from_dt.strftime("%Y%m%d")

    if from_str > trading_date:
        print(f"   No new range to fetch. Skipping.")
        return True

    print(f"  Fetch range: {from_str} ~ {trading_date}")

    # Load core + extended universe
    res = supabase.table("stocks") \
        .select("code, name") \
        .in_("universe_level", ["core", "extended"]) \
        .eq("is_active", True) \
        .execute()
    tickers = [(r["code"], r["name"]) for r in (res.data or [])]

    if not tickers:
        print("   No active stocks found.")
        return False

    print(f"  Universe size: {len(tickers)} tickers")

    success = 0
    fail = 0
    upsert_buffer: list = []
    date_range_found = set()

    for idx, (code, name) in enumerate(tickers):
        if idx % 50 == 0 and idx > 0:
            print(f"  -> Progress: {idx}/{len(tickers)} (success: {success}, fail: {fail})")
            if upsert_buffer:
                _flush_stock_daily(supabase, upsert_buffer)
                upsert_buffer = []

        try:
            from _price_adjustment import adjust_ohlcv_for_splits
            df = stock.get_market_ohlcv(from_str, trading_date, code)
            if df.empty:
                continue

            df, split_events = adjust_ohlcv_for_splits(df)
            if split_events:
                print(f"    ? {code} split-adjust: {', '.join(split_events[:2])}")

            for dt_idx, row in df.iterrows():
                vol = safe_int(row.get("거래량", 0))
                if vol == 0:
                    continue
                dt_str = dt_idx.strftime("%Y-%m-%d") if hasattr(dt_idx, "strftime") else str(dt_idx)[:10]
                date_range_found.add(dt_str)
                close_val = safe_int(row.get("종가"))
                value = row.get("거래대금")
                if value == 0 or value == '' or (hasattr(value, '__iter__') and len(str(value)) == 0):
                    value = vol * close_val
                upsert_buffer.append({
                    "ticker": code,
                    "date": dt_str,
                    "open": safe_int(row.get("시가")),
                    "high": safe_int(row.get("고가")),
                    "low": safe_int(row.get("저가")),
                    "close": close_val,
                    "volume": vol,
                    "value": safe_float(value),
                })

            success += 1
            time.sleep(0.15)

        except Exception as e:
            fail += 1
            if fail <= 5:
                print(f"     {code} ({name}): {e}")
            time.sleep(0.3)

    if upsert_buffer:
        _flush_stock_daily(supabase, upsert_buffer)

    print(f"   OHLCV collection done: {success} success, {fail} fail")
    
    if date_range_found:
        min_date = min(date_range_found)
        max_date = max(date_range_found)
        print(f"  Data date range fetched: {min_date} ~ {max_date}")
        
        max_date_obj = datetime.strptime(max_date, "%Y-%m-%d").date()
        trading_date_obj = datetime.strptime(trading_date, "%Y%m%d").date()
        freshness_gap = (trading_date_obj - max_date_obj).days
        
        if freshness_gap > 5:
            print(f"   Warning: latest fetched date ({max_date}) lags target ({trading_date}) by {freshness_gap} days")
            print(f"   pykrx API may not have latest market data. Retry with explicit date.")
            return False
        else:
            print(f"   Freshness check passed: lag {freshness_gap} days")

    _update_stocks_close(supabase, trading_date)
    return success > 0


def _flush_stock_daily(supabase: Client, rows: list):
    """Upsert stock_daily in batches."""
    for i in range(0, len(rows), 500):
        try:
            supabase.table("stock_daily").upsert(rows[i:i+500]).execute()
        except Exception as e:
            print(f"     stock_daily upsert error: {e}")
            chunk = rows[i:i+500]
            for j in range(0, len(chunk), 50):
                try:
                    supabase.table("stock_daily").upsert(chunk[j:j+50]).execute()
                except:
                    pass


def _update_stocks_close(supabase: Client, trading_date: str):
    """Sync latest close price to stocks table."""
    trading_iso = to_iso(trading_date)
    print("  -> syncing latest close into stocks...")
    try:
        stocks_res = supabase.table("stocks") \
            .select("code, name").eq("is_active", True) \
            .not_.is_("name", "null").execute()
        valid_stocks = {r["code"]: r["name"] for r in (stocks_res.data or [])}

        res = supabase.table("stock_daily") \
            .select("ticker, close") \
            .eq("date", trading_iso).execute()

        updates = [{
            "code": r["ticker"],
            "name": valid_stocks[r["ticker"]],
            "close": safe_int(r["close"]),
            "updated_at": datetime.now().isoformat(),
        } for r in (res.data or []) if r["ticker"] in valid_stocks]

        for i in range(0, len(updates), 200):
            supabase.table("stocks").upsert(updates[i:i+200]).execute()
        print(f"   updated close for {len(updates)} stocks")
    except Exception as e:
        print(f"   close sync error: {e}")


