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
    
    # 공백이 커도 테이블을 비우지 않는다. 예전엔 30일 초과 공백이면 stock_daily 전체를 삭제했는데,
    # 백테스트·지표·학습이 모두 이 테이블의 과거 이력에 의존하므로 복구 불가능한 손실이 된다.
    # 아래 180일 상한으로 재수집 범위만 제한하고, 기존 행은 upsert로 덮어쓴다.
    days_gap = (trading_dt - latest_dt).days
    if days_gap > 30:
        print(f"   Warning: DB gap is {days_gap} days (latest: {latest_date}, target: {trading_date}) — refetching without reset")

    from_dt = datetime.strptime(latest_date, "%Y-%m-%d") + timedelta(days=1)

    # 증분 시작점이 "전체 최신 날짜 다음날"이라, 어떤 날 일부 종목만 수집되면(차단·타임아웃) 그 종목의
    # 빈 날짜가 영영 채워지지 않았다(예: 2026-05-22 66종목만 수집, 09-22 core 3종목 누락).
    # 종목당 API 호출은 기간과 무관하게 1회이므로, 최근 REFETCH_DAYS를 항상 다시 받아 구멍을 자가복구한다.
    # 단, 이미 target까지 수집된 상태의 재실행은 기존처럼 스킵한다(KRX 대량조회 차단 위험 방지).
    REFETCH_DAYS = 10
    refetch_from = datetime.combine(trading_dt - timedelta(days=REFETCH_DAYS), datetime.min.time())
    if from_dt.date() <= trading_dt and from_dt > refetch_from:
        from_dt = refetch_from

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
            # KRX 자동화 대량조회 탐지(IP 접속제한)를 피하기 위해 종목당 간격을 넉넉히 둔다.
            time.sleep(0.3)

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
    sub_batch_fail = 0
    for i in range(0, len(rows), 500):
        try:
            supabase.table("stock_daily").upsert(rows[i:i+500], on_conflict="ticker,date").execute()
        except Exception as e:
            print(f"     stock_daily upsert error: {e}")
            chunk = rows[i:i+500]
            for j in range(0, len(chunk), 50):
                try:
                    time.sleep(0.5)
                    supabase.table("stock_daily").upsert(chunk[j:j+50], on_conflict="ticker,date").execute()
                except:
                    sub_batch_fail += 1
    if sub_batch_fail > 0:
        print(f"     [WARN] stock_daily sub-batch upsert failures: {sub_batch_fail}")


def _update_stocks_close(supabase: Client, trading_date: str):
    """Sync latest close price to stocks table."""
    trading_iso = to_iso(trading_date)
    print("  -> syncing latest close into stocks...")
    try:
        res = supabase.table("stock_daily") \
            .select("ticker, close") \
            .eq("date", trading_iso).execute()
        daily_rows = res.data or []
        if not daily_rows:
            print("   no stock_daily rows for this date, skipping close sync")
            return

        # stock_daily 대상 종목만 조회 (전체 활성 종목을 조회하면 PostgREST
        # 기본 페이지 제한(1000행)에 걸려 일부 종목만 갱신되던 문제 방지)
        tickers = list({r["ticker"] for r in daily_rows})
        valid_stocks: dict = {}
        for i in range(0, len(tickers), 500):
            chunk_res = supabase.table("stocks") \
                .select("code, name").eq("is_active", True) \
                .not_.is_("name", "null") \
                .in_("code", tickers[i:i + 500]).execute()
            valid_stocks.update({r["code"]: r["name"] for r in (chunk_res.data or [])})

        updates = [{
            "code": r["ticker"],
            "name": valid_stocks[r["ticker"]],
            "close": safe_int(r["close"]),
            "updated_at": datetime.now().isoformat(),
        } for r in daily_rows if r["ticker"] in valid_stocks]

        for i in range(0, len(updates), 200):
            supabase.table("stocks").upsert(updates[i:i+200]).execute()
        print(f"   updated close for {len(updates)} stocks")
    except Exception as e:
        print(f"   close sync error: {e}")


