"""
batch_modules/backfill.py
========================
??? ?? ?? ??
"""

import os
from datetime import datetime, timedelta, date
from typing import Optional
from supabase import Client
from .utils import safe_int, run_python_script


def get_latest_stock_daily_date(supabase: Client) -> Optional[str]:
    """Get latest date from stock_daily."""
    try:
        latest_res = supabase.table("stock_daily") \
            .select("date").order("date", desc=True).limit(1).execute()
        return latest_res.data[0]["date"] if latest_res.data else None
    except Exception as e:
        print(f"   Failed to query latest stock_daily date: {e}")
        return None


def get_earliest_stock_daily_date(supabase: Client) -> Optional[str]:
    """Get earliest date from stock_daily."""
    try:
        earliest_res = supabase.table("stock_daily") \
            .select("date").order("date", desc=False).limit(1).execute()
        return earliest_res.data[0]["date"] if earliest_res.data else None
    except Exception as e:
        print(f"   Failed to query earliest stock_daily date: {e}")
        return None


def auto_backfill_missing_dates(supabase: Client, trading_date: str) -> bool:
    """Auto-backfill forward/history gaps for stock_daily and indicators."""
    latest_date = get_latest_stock_daily_date(supabase)
    if not latest_date:
        print("  Could not determine latest stock_daily date; skip auto-backfill.")
        return False

    backfilled = False
    latest_dt = datetime.strptime(latest_date, "%Y-%m-%d").date()
    trading_dt = datetime.strptime(trading_date, "%Y%m%d").date()

    # 1) Forward fill to the target trading date
    if latest_dt < trading_dt:
        gap_days = (trading_dt - latest_dt).days
        start_date = (latest_dt + timedelta(days=1)).strftime("%Y%m%d")
        print(
            f"   Forward gap detected: stock_daily {latest_date} < target {trading_date} (gap {gap_days}d)"
        )
        print(f"   Forward backfill range: {start_date} ~ {trading_date}")

        ok_stock = run_python_script(
            "scripts/backfill_stock_daily_universe.py",
            ["--start", start_date, "--end", trading_date, "--universe", "core-extended", "--sleep", "0.08"],
            "stock_daily backfill",
        )
        if not ok_stock:
            return False

        ok_indicators = run_python_script(
            "scripts/backfill_daily_indicators.py",
            ["--start", start_date, "--end", trading_date],
            "daily_indicators backfill",
        )
        if not ok_indicators:
            return False

        backfilled = True
        latest_dt = trading_dt
    else:
        print(f"   stock_daily is already up to date. ({latest_date} >= {trading_date})")

    # 2) Historical fill for retention window
    stock_retention_days = safe_int(os.environ.get("STOCK_DAILY_RETENTION_DAYS", 400), 400)
    stock_retention_days = max(400, stock_retention_days)
    target_start_dt = trading_dt - timedelta(days=stock_retention_days)

    earliest_date = get_earliest_stock_daily_date(supabase)
    if not earliest_date:
        print("  Could not determine earliest stock_daily date; skip historical fill.")
        return backfilled

    earliest_dt = datetime.strptime(earliest_date, "%Y-%m-%d").date()
    if earliest_dt > target_start_dt:
        hist_start = target_start_dt.strftime("%Y%m%d")
        hist_end = (earliest_dt - timedelta(days=1)).strftime("%Y%m%d")
        missing_days = (earliest_dt - target_start_dt).days
        print(
            f"   Historical gap detected: earliest {earliest_date}, target start <= {target_start_dt.isoformat()} (missing {missing_days}d)"
        )
        print(f"   Historical backfill range: {hist_start} ~ {hist_end}")

        ok_stock_hist = run_python_script(
            "scripts/backfill_stock_daily_universe.py",
            ["--start", hist_start, "--end", hist_end, "--universe", "core-extended", "--sleep", "0.08"],
            "stock_daily historical backfill",
        )
        if not ok_stock_hist:
            return backfilled

        ok_indicators_hist = run_python_script(
            "scripts/backfill_daily_indicators.py",
            ["--start", hist_start, "--end", hist_end],
            "daily_indicators historical backfill",
        )
        if not ok_indicators_hist:
            return backfilled

        backfilled = True
    else:
        print(
            f"   Historical coverage OK: earliest {earliest_date}, required start <= {target_start_dt.isoformat()}"
        )

    return backfilled


