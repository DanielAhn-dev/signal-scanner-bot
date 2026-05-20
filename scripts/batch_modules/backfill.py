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
    """stock_daily ?? ?? ??"""
    try:
        latest_res = supabase.table("stock_daily") \
            .select("date").order("date", desc=True).limit(1).execute()
        return latest_res.data[0]["date"] if latest_res.data else None
    except Exception as e:
        print(f"   stock_daily ??? ?? ??: {e}")
        return None


def get_earliest_stock_daily_date(supabase: Client) -> Optional[str]:
    """stock_daily ?? ?? ??"""
    try:
        earliest_res = supabase.table("stock_daily") \
            .select("date").order("date", desc=False).limit(1).execute()
        return earliest_res.data[0]["date"] if earliest_res.data else None
    except Exception as e:
        print(f"   stock_daily ??? ?? ??: {e}")
        return None


def auto_backfill_missing_dates(supabase: Client, trading_date: str) -> bool:
    """??? ?? ?? ??"""
    latest_date = get_latest_stock_daily_date(supabase)
    if not latest_date:
        print("  ? stock_daily ???? ?? ?? ?? ??? ?????.")
        return False

    backfilled = False
    latest_dt = datetime.strptime(latest_date, "%Y-%m-%d").date()
    trading_dt = datetime.strptime(trading_date, "%Y%m%d").date()

    # 1) ??? ?? ?? ?? ?? ??
    if latest_dt < trading_dt:
        gap_days = (trading_dt - latest_dt).days
        start_date = (latest_dt + timedelta(days=1)).strftime("%Y%m%d")
        print(
            f"   ?? ?? ??: stock_daily ?? {latest_date} < ?? {trading_date} (gap {gap_days}?)"
        )
        print(f"   ?? ??: {start_date} ~ {trading_date}")

        ok_stock = run_python_script(
            "scripts/backfill_stock_daily_universe.py",
            ["--start", start_date, "--end", trading_date, "--universe", "core-extended", "--sleep", "0.08"],
            "stock_daily ??",
        )
        if not ok_stock:
            return False

        ok_indicators = run_python_script(
            "scripts/backfill_daily_indicators.py",
            ["--start", start_date, "--end", trading_date],
            "daily_indicators ??",
        )
        if not ok_indicators:
            return False

        backfilled = True
        latest_dt = trading_dt
    else:
        print(f"   stock_daily ???? ??? ?????. ({latest_date} >= {trading_date})")

    # 2) ?? ?? ?? ?? ?? ??
    stock_retention_days = safe_int(os.environ.get("STOCK_DAILY_RETENTION_DAYS", 400), 400)
    stock_retention_days = max(400, stock_retention_days)
    target_start_dt = trading_dt - timedelta(days=stock_retention_days)

    earliest_date = get_earliest_stock_daily_date(supabase)
    if not earliest_date:
        print("  ? stock_daily ???? ?? ?? ?? ???? ??? ?????.")
        return backfilled

    earliest_dt = datetime.strptime(earliest_date, "%Y-%m-%d").date()
    if earliest_dt > target_start_dt:
        hist_start = target_start_dt.strftime("%Y%m%d")
        hist_end = (earliest_dt - timedelta(days=1)).strftime("%Y%m%d")
        missing_days = (earliest_dt - target_start_dt).days
        print(
            f"   ?? ?? ?? ??: ?? {earliest_date}, ?? <= {target_start_dt.isoformat()} (?? {missing_days}?)"
        )
        print(f"   ?? ?? ??: {hist_start} ~ {hist_end}")

        ok_stock_hist = run_python_script(
            "scripts/backfill_stock_daily_universe.py",
            ["--start", hist_start, "--end", hist_end, "--universe", "core-extended", "--sleep", "0.08"],
            "stock_daily ?? ??",
        )
        if not ok_stock_hist:
            return backfilled

        ok_indicators_hist = run_python_script(
            "scripts/backfill_daily_indicators.py",
            ["--start", hist_start, "--end", hist_end],
            "daily_indicators ?? ??",
        )
        if not ok_indicators_hist:
            return backfilled

        backfilled = True
    else:
        print(
            f"   ?? ?? ?? ??: ?? {earliest_date}, ?? ?? <= {target_start_dt.isoformat()}"
        )

    return backfilled


