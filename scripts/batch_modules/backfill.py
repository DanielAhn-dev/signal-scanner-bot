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
    """
    Return trading dates(YYYYMMDD) between start/end.

    유동성 최상위 종목(삼성전자)의 기간 일봉 1회 조회로 거래일 달력을 만든다.
    예전엔 pykrx 지수 API(get_index_ohlcv)를 먼저 쓰고 실패하면 하루씩 get_market_ohlcv를 호출했는데,
    지수 API가 KRX 응답 변경으로 항상 KeyError를 내면서 매 배치마다 날짜 수만큼(35~180회) KRX를
    호출하는 폴백으로 빠졌다(대량조회 차단 위험). 하루 단위 폴백은 없앴다.
    """
    if start_dt > end_dt:
        return []

    start = start_dt.strftime("%Y%m%d")
    end = end_dt.strftime("%Y%m%d")

    try:
        from pykrx import stock as pykrx_stock

        df = pykrx_stock.get_market_ohlcv(start, end, DEFAULT_SENTINEL_TICKERS[0])
        if df is not None and not df.empty:
            return [idx.strftime("%Y%m%d") for idx in df.index]
    except Exception as e:
        print(f"   Trading calendar lookup failed: {str(e)[:120]}")

    return []


def fetch_universe_codes(supabase: Client) -> list[str]:
    """core+extended 활성 종목 코드 (PostgREST 1000행 상한을 넘어도 끝까지 페이지 조회)."""
    codes: list[str] = []
    offset = 0
    while True:
        rows = (
            supabase.table("stocks")
            .select("code")
            .eq("is_active", True)
            .in_("universe_level", ["core", "extended"])
            .order("code")
            .range(offset, offset + 999)
            .execute()
            .data
            or []
        )
        codes.extend(str(r.get("code") or "").strip() for r in rows if r.get("code"))
        if len(rows) < 1000:
            break
        offset += 1000
    return codes


def fetch_present_pairs(supabase: Client, codes: list[str], start_iso: str, end_iso: str) -> dict[str, set[str]]:
    """종목별로 stock_daily에 존재하는 날짜(YYYYMMDD) 집합."""
    present: dict[str, set[str]] = {code: set() for code in codes}
    for i in range(0, len(codes), 50):
        chunk = codes[i:i + 50]
        offset = 0
        while True:
            rows = (
                supabase.table("stock_daily")
                .select("ticker,date")
                .in_("ticker", chunk)
                .gte("date", start_iso)
                .lte("date", end_iso)
                .order("ticker")
                .order("date")
                .range(offset, offset + 999)
                .execute()
                .data
                or []
            )
            for row in rows:
                ticker = str(row.get("ticker") or "")
                raw = str(row.get("date") or "")[:10]
                if ticker in present and len(raw) == 10:
                    present[ticker].add(raw.replace("-", ""))
            if len(rows) < 1000:
                break
            offset += 1000
    return present


def plan_stock_daily_gap_heal(
    trading_calendar: list[str],
    present: dict[str, set[str]],
    max_tickers: int,
    rotation_seed: int,
) -> dict:
    """
    복구 계획을 세운다(순수 함수).
    - 종목별 누락일 = 거래일 중 그 종목의 기간 내 첫 기록일 이후인데 행이 없는 날 (상장 전 구간은 제외)
    - 누락 종목을 코드순으로 줄 세운 뒤 날짜 기반 오프셋으로 회전해 max_tickers개만 고른다.
      상태 저장 없이도 며칠에 걸쳐 전 종목이 한 번씩 돌아오고, 거래정지 종목(영구 누락)이
      매번 할당량을 독차지하지 않는다.
    """
    missing_by_code: dict[str, list[str]] = {}
    for code, dates in present.items():
        if not dates:
            continue
        first = min(dates)
        missing = [d for d in trading_calendar if d >= first and d not in dates]
        if missing:
            missing_by_code[code] = missing

    candidates = sorted(missing_by_code)
    picked: list[str] = []
    if candidates and max_tickers > 0:
        offset = (rotation_seed * max_tickers) % len(candidates)
        rotated = candidates[offset:] + candidates[:offset]
        picked = rotated[:max_tickers]

    picked_dates = [d for code in picked for d in missing_by_code[code]]
    return {
        "missing_tickers": len(missing_by_code),
        "missing_pairs": sum(len(v) for v in missing_by_code.values()),
        "codes": picked,
        "start": min(picked_dates) if picked_dates else None,
        "end": max(picked_dates) if picked_dates else None,
    }


def heal_stock_daily_gaps(supabase: Client, trading_date: str) -> bool:
    """
    stock_daily 종목 단위 구멍을 하루 할당량만큼만 복구한다.

    예전 방식은 대표 3종목으로 "날짜 전체 누락"만 감지하고, 감지되면 core+extended 전 종목(약 218개)을
    0.08초 간격으로 다시 받았다. 일부 종목만 빠진 날(2026-05-22 66종목, 09-22 core 3종목)은 못 잡고,
    잡히면 한 번에 대량 조회라 KRX 접속 차단 위험이 컸다.
    이제 종목별 누락을 계산해 하루 AUTO_GAP_HEAL_MAX_TICKERS개(기본 25)만 느린 간격으로 받는다.
    종목당 KRX 호출은 기간과 무관하게 1회라서 오래된 구멍도 같은 비용으로 메워진다.
    """
    window_days = max(20, min(200, safe_int(os.environ.get("AUTO_GAP_HEAL_WINDOW_DAYS", 180), 180)))
    max_tickers = max(0, safe_int(os.environ.get("AUTO_GAP_HEAL_MAX_TICKERS", 25), 25))
    sleep_sec = os.environ.get("AUTO_GAP_HEAL_SLEEP_SEC", "0.6")
    if max_tickers <= 0:
        print("   Gap heal disabled (AUTO_GAP_HEAL_MAX_TICKERS=0)")
        return False

    trading_dt = datetime.strptime(trading_date, "%Y%m%d").date()
    start_dt = trading_dt - timedelta(days=window_days)
    # 당일은 정규 수집(forward fill) 몫이라 전날까지만 본다
    calendar = get_trading_dates_between(start_dt, trading_dt - timedelta(days=1))
    if not calendar:
        print("   Gap heal skipped: failed to build trading calendar")
        return False

    codes = fetch_universe_codes(supabase)
    if not codes:
        print("   Gap heal skipped: empty universe")
        return False
    present = fetch_present_pairs(supabase, codes, start_dt.isoformat(), trading_dt.isoformat())
    plan = plan_stock_daily_gap_heal(calendar, present, max_tickers, trading_dt.toordinal())

    if not plan["codes"]:
        print(f"   Gap heal: no missing (ticker,date) in last {window_days}d across {len(codes)} tickers")
        return False

    print(
        f"   Gap heal: {plan['missing_pairs']} missing (ticker,date) across {plan['missing_tickers']} tickers "
        f"in last {window_days}d → healing {len(plan['codes'])} tickers today ({plan['start']} ~ {plan['end']})"
    )
    ok_stock = run_python_script(
        "scripts/backfill_stock_daily_universe.py",
        [
            "--start", plan["start"],
            "--end", plan["end"],
            "--universe", "core-extended",
            "--codes", ",".join(plan["codes"]),
            "--sleep", str(sleep_sec),
        ],
        "stock_daily gap heal",
    )
    if not ok_stock:
        return False
    ok_indicators = run_python_script(
        "scripts/backfill_daily_indicators.py",
        ["--start", plan["start"], "--end", plan["end"]],
        "daily_indicators gap heal",
    )
    return bool(ok_indicators)


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
        # "전체 최신일 다음날"부터만 받으면 전날 일부 종목만 수집된 구멍이 남는다.
        # 종목당 호출은 기간과 무관하게 1회이므로 최근 10일을 함께 다시 받아 자가복구한다.
        start_date = min(
            latest_dt + timedelta(days=1),
            trading_dt - timedelta(days=10),
        ).strftime("%Y%m%d")
        print(
            f"   Forward gap detected: stock_daily {latest_date} < target {trading_date} (gap {gap_days}d)"
        )
        print(f"   Forward backfill range: {start_date} ~ {trading_date}")

        ok_stock = run_python_script(
            "scripts/backfill_stock_daily_universe.py",
            ["--start", start_date, "--end", trading_date, "--universe", "core-extended", "--sleep", "0.3"],
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

    # 1.5) 내부 구멍 복구: 종목 단위 누락을 하루 할당량만큼만 천천히 메운다 (heal_stock_daily_gaps 참고)
    if heal_stock_daily_gaps(supabase, trading_date):
        backfilled = True

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


