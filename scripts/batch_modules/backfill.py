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


DEFAULT_SENTINEL_TICKERS = ["005930", "000660", "035420"]


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


def get_trading_dates_between(start_dt: date, end_dt: date) -> list[str]:
    """Return trading dates(YYYYMMDD) between start/end using pykrx."""
    if start_dt > end_dt:
        return []

    start = start_dt.strftime("%Y%m%d")
    end = end_dt.strftime("%Y%m%d")

    # Fast path: single index call for trading calendar.
    try:
        from pykrx import stock as pykrx_stock

        df = pykrx_stock.get_index_ohlcv(start, end, "1001")
        if df is not None and not df.empty:
            return [idx.strftime("%Y%m%d") for idx in df.index]
    except Exception:
        pass

    # Fallback: day-by-day check on a liquid sentinel ticker.
    out: list[str] = []
    try:
        from pykrx import stock as pykrx_stock

        cur = start_dt
        while cur <= end_dt:
            yyyymmdd = cur.strftime("%Y%m%d")
            try:
                df = pykrx_stock.get_market_ohlcv(yyyymmdd, yyyymmdd, "005930")
                if df is not None and not df.empty:
                    out.append(yyyymmdd)
            except Exception:
                pass
            cur += timedelta(days=1)
    except Exception:
        return []

    return out


def get_present_dates_from_stock_daily(
    supabase: Client,
    start_iso: str,
    end_iso: str,
    sentinels: list[str],
) -> set[str]:
    """Read present dates from stock_daily using a few sentinel tickers."""
    present: set[str] = set()
    page_size = 1000
    offset = 0

    while True:
        try:
            res = (
                supabase.table("stock_daily")
                .select("date,ticker")
                .in_("ticker", sentinels)
                .gte("date", start_iso)
                .lte("date", end_iso)
                .order("date", desc=False)
                .range(offset, offset + page_size - 1)
                .execute()
            )
            rows = res.data or []
        except Exception as e:
            print(f"   Failed to query stock_daily date coverage: {e}")
            return present

        for row in rows:
            raw = str(row.get("date") or "").strip()
            if len(raw) >= 10:
                present.add(raw[:10].replace("-", ""))

        if len(rows) < page_size:
            break
        offset += page_size

    return present


def group_consecutive_dates(dates_yyyymmdd: list[str]) -> list[tuple[str, str]]:
    """Group sorted YYYYMMDD dates into consecutive ranges."""
    if not dates_yyyymmdd:
        return []

    out: list[tuple[str, str]] = []
    start = dates_yyyymmdd[0]
    prev = datetime.strptime(start, "%Y%m%d").date()

    for cur_s in dates_yyyymmdd[1:]:
        cur = datetime.strptime(cur_s, "%Y%m%d").date()
        if (cur - prev).days == 1:
            prev = cur
            continue
        out.append((start, prev.strftime("%Y%m%d")))
        start = cur_s
        prev = cur

    out.append((start, prev.strftime("%Y%m%d")))
    return out


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

    # 1.5) Internal gap fill for recent trading dates
    gap_window_days = safe_int(os.environ.get("AUTO_BACKFILL_GAP_WINDOW_DAYS", 35), 35)
    gap_window_days = max(7, min(120, gap_window_days))
    gap_start_dt = trading_dt - timedelta(days=gap_window_days)

    trading_days = get_trading_dates_between(gap_start_dt, trading_dt)
    if trading_days:
        present_dates = get_present_dates_from_stock_daily(
            supabase,
            gap_start_dt.isoformat(),
            trading_dt.isoformat(),
            DEFAULT_SENTINEL_TICKERS,
        )
        missing_days = sorted([d for d in trading_days if d not in present_dates])

        if missing_days:
            print(
                f"   Internal gaps detected in last {gap_window_days}d: {len(missing_days)} trading day(s)"
                f" ({missing_days[0]} ~ {missing_days[-1]})"
            )

            for start_date, end_date in group_consecutive_dates(missing_days):
                print(f"   Internal backfill range: {start_date} ~ {end_date}")

                ok_stock_gap = run_python_script(
                    "scripts/backfill_stock_daily_universe.py",
                    ["--start", start_date, "--end", end_date, "--universe", "core-extended", "--sleep", "0.08"],
                    "stock_daily internal-gap backfill",
                )
                if not ok_stock_gap:
                    return backfilled

                ok_indicators_gap = run_python_script(
                    "scripts/backfill_daily_indicators.py",
                    ["--start", start_date, "--end", end_date],
                    "daily_indicators internal-gap backfill",
                )
                if not ok_indicators_gap:
                    return backfilled

                backfilled = True
        else:
            print(f"   Internal gap check OK: no missing trading dates in last {gap_window_days}d")
    else:
        print("   Internal gap check skipped: failed to build trading calendar")

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


