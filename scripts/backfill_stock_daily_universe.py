"""
stock_daily 과거 구간 백필 스크립트.
- pykrx로 종목별 OHLCV를 수집해 stock_daily에 upsert
- 기본: 활성 종목(is_active=true) 전체
- 목적: 90/120 Horizon 라벨 가능 구간 확보
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable

import pandas as pd
from pykrx import stock
from supabase import Client, create_client

from _price_adjustment import adjust_ohlcv_for_splits


def load_env_file(filepath: str = ".env") -> None:
    p = Path(filepath)
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, value = s.split("=", 1)
        key = key.strip()
        if key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


def to_yyyymmdd(value: str) -> str:
    s = value.strip().replace("-", "")
    if len(s) != 8 or not s.isdigit():
        raise ValueError(f"invalid date: {value}")
    return s


def to_iso(yyyymmdd: str) -> str:
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


def safe_int(value: object, default: int = 0) -> int:
    try:
        n = int(float(value))
        return n
    except Exception:
        return default


def safe_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def detect_last_trading_date() -> str:
    today = datetime.now().date()
    test_codes = ["005930", "000660", "035420"]

    for i in range(0, 40):
        d = today - timedelta(days=i)
        d_str = d.strftime("%Y%m%d")
        ok = 0
        for code in test_codes:
            try:
                df = stock.get_market_ohlcv(d_str, d_str, code)
                if not df.empty and safe_int(df.iloc[0].get("거래량", 0), 0) > 0:
                    ok += 1
            except Exception:
                continue
        if ok >= 2:
            return d_str

    return today.strftime("%Y%m%d")


def fetch_target_codes(supabase: Client, universe: str) -> list[tuple[str, str]]:
    query = supabase.table("stocks").select("code,name,is_active,universe_level")

    if universe == "active":
        query = query.eq("is_active", True)
    elif universe == "core-extended":
        query = query.eq("is_active", True).in_("universe_level", ["core", "extended"])

    rows = query.execute().data or []

    out: list[tuple[str, str]] = []
    for row in rows:
        code = str(row.get("code") or "").strip()
        name = str(row.get("name") or code).strip()
        if code:
            out.append((code, name))

    out.sort(key=lambda x: x[0])
    return out


def chunked(items: Iterable[dict], size: int) -> Iterable[list[dict]]:
    buf: list[dict] = []
    for item in items:
        buf.append(item)
        if len(buf) >= size:
            yield buf
            buf = []
    if buf:
        yield buf


def flush_stock_daily(supabase: Client, rows: list[dict], batch_size: int, dry_run: bool) -> int:
    if not rows:
        return 0
    if dry_run:
        return len(rows)

    ok = 0
    for batch in chunked(rows, batch_size):
        try:
            supabase.table("stock_daily").upsert(batch).execute()
            ok += len(batch)
        except Exception as e:
            print(f"    [WARN] batch upsert failed: {str(e)[:120]}")
            for row in batch:
                try:
                    supabase.table("stock_daily").upsert([row]).execute()
                    ok += 1
                except Exception:
                    continue
    return ok


def collect_rows_for_code(code: str, start: str, end: str) -> list[dict]:
    rows: list[dict] = []

    df = stock.get_market_ohlcv(start, end, code)
    if df is None or df.empty:
        return rows

    df, _ = adjust_ohlcv_for_splits(df)

    for dt_idx, row in df.iterrows():
        volume = safe_int(row.get("거래량", 0), 0)
        if volume <= 0:
            continue

        close_val = safe_int(row.get("종가", 0), 0)
        value = row.get("거래대금")
        if pd.isna(value) or value in (None, "", 0):
            value = volume * close_val

        dt_str = dt_idx.strftime("%Y-%m-%d") if hasattr(dt_idx, "strftime") else str(dt_idx)[:10]
        rows.append(
            {
                "ticker": code,
                "date": dt_str,
                "open": safe_int(row.get("시가", 0), 0),
                "high": safe_int(row.get("고가", 0), 0),
                "low": safe_int(row.get("저가", 0), 0),
                "close": close_val,
                "volume": volume,
                "value": safe_float(value, 0.0),
            }
        )

    return rows


def parse_args() -> argparse.Namespace:
    default_end = detect_last_trading_date()
    default_start = (datetime.strptime(default_end, "%Y%m%d") - timedelta(days=420)).strftime("%Y%m%d")

    parser = argparse.ArgumentParser(description="stock_daily historical backfill")
    parser.add_argument("--start", default=default_start, help="start date (YYYYMMDD or YYYY-MM-DD)")
    parser.add_argument("--end", default=default_end, help="end date (YYYYMMDD or YYYY-MM-DD)")
    parser.add_argument(
        "--universe",
        default="active",
        choices=["active", "core-extended", "all"],
        help="target universe",
    )
    parser.add_argument("--codes", default="", help="comma separated codes (optional)")
    parser.add_argument("--max-codes", type=int, default=0, help="limit number of codes")
    parser.add_argument("--sleep", type=float, default=0.12, help="delay seconds per code")
    parser.add_argument("--batch-size", type=int, default=500, help="upsert batch size")
    parser.add_argument("--dry-run", action="store_true", help="collect only, do not write DB")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    load_env_file()

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        print("[ERROR] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing", file=sys.stderr)
        sys.exit(1)

    start = to_yyyymmdd(args.start)
    end = to_yyyymmdd(args.end)
    if start > end:
        raise ValueError("start must be <= end")

    supabase: Client = create_client(supabase_url, supabase_key)

    targets = fetch_target_codes(supabase, args.universe)

    if args.codes.strip():
        picked = {x.strip() for x in args.codes.split(",") if x.strip()}
        targets = [x for x in targets if x[0] in picked]

    if args.max_codes > 0:
        targets = targets[: args.max_codes]

    print("=" * 64)
    print("stock_daily backfill")
    print("=" * 64)
    print(f"range: {to_iso(start)} ~ {to_iso(end)}")
    print(f"universe: {args.universe}")
    print(f"targets: {len(targets)}")
    print(f"dry_run: {args.dry_run}")

    if not targets:
        print("no target codes")
        return

    success_codes = 0
    fail_codes = 0
    total_rows = 0
    upserted_rows = 0

    for idx, (code, name) in enumerate(targets, start=1):
        try:
            rows = collect_rows_for_code(code, start, end)
            if rows:
                upserted = flush_stock_daily(supabase, rows, args.batch_size, args.dry_run)
                total_rows += len(rows)
                upserted_rows += upserted
                success_codes += 1
            if idx % 50 == 0 or idx == len(targets):
                print(
                    f"  -> {idx}/{len(targets)} codes | success={success_codes} fail={fail_codes} "
                    f"rows={total_rows:,} upserted={upserted_rows:,}"
                )
            time.sleep(max(0.0, args.sleep))
        except Exception as e:
            fail_codes += 1
            if fail_codes <= 10:
                print(f"  [WARN] {code} ({name}) failed: {str(e)[:120]}")
            time.sleep(max(0.0, args.sleep * 2))

    print("-" * 64)
    print(
        f"done | success_codes={success_codes} fail_codes={fail_codes} "
        f"rows={total_rows:,} upserted={upserted_rows:,}"
    )


if __name__ == "__main__":
    main()
