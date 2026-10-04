from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date, datetime, timedelta
from typing import Optional

import requests
from supabase import Client, create_client


def load_env_file(filepath: str = ".env") -> None:
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if key and key not in os.environ:
                    os.environ[key] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass


def yyyymmdd_to_date(value: str) -> date:
    return datetime.strptime(value, "%Y%m%d").date()


def date_to_yyyymmdd(value: date) -> str:
    return value.strftime("%Y%m%d")


def parse_iso_date(value: str) -> date:
    return datetime.fromisoformat(str(value)).date()


def to_iso(value: date) -> str:
    return value.isoformat()


def parse_signed_int(value) -> int:
    s = str(value or "").strip()
    if not s or s.lower() == "nan":
        return 0
    s = s.replace(",", "").replace("\u2212", "-")
    s = "".join(ch for ch in s if ch.isdigit() or ch in ("-", "+"))
    if not s or s in ("-", "+"):
        return 0
    try:
        return int(s)
    except Exception:
        return 0


def fetch_rows_for_code(
    session: requests.Session,
    code: str,
    start_dt: date,
    end_dt: date,
    max_pages: int,
    sleep_seconds: float,
) -> list[dict]:
    """외국인·기관 순매매량(주). 예전 finance.naver.com/item/frgn.naver 표는 2026-10 새 증권 사이트로
    넘어가 사라져서 모바일 API(/api/stock/{code}/trend, 최신부터 60일씩, bizdate 이전으로 넘김)를 쓴다."""
    collected: dict[tuple[str, str], dict] = {}
    bizdate = (end_dt + timedelta(days=1)).strftime("%Y%m%d")

    for _ in range(max_pages):
        url = f"https://m.stock.naver.com/api/stock/{code}/trend?pageSize=60&bizdate={bizdate}"
        resp = session.get(url, timeout=8)
        resp.raise_for_status()
        items = resp.json() or []
        if not items:
            break

        earliest = None
        for item in items:
            raw = str(item.get("bizdate") or "")
            try:
                row_dt = datetime.strptime(raw, "%Y%m%d").date()
            except ValueError:
                continue
            earliest = raw if earliest is None or raw < earliest else earliest
            if row_dt < start_dt or row_dt > end_dt:
                continue
            institution = parse_signed_int(item.get("organPureBuyQuant"))
            foreign = parse_signed_int(item.get("foreignerPureBuyQuant"))
            if institution == 0 and foreign == 0:
                continue
            collected[(code, to_iso(row_dt))] = {
                "date": to_iso(row_dt),
                "ticker": code,
                "institution": institution,
                "foreign": foreign,
            }

        if earliest is None or earliest >= bizdate or earliest < start_dt.strftime("%Y%m%d"):
            break
        bizdate = earliest

        if sleep_seconds > 0:
            time.sleep(sleep_seconds)

    return list(collected.values())


def upsert_rows(supabase: Client, rows: list[dict]) -> int:
    if not rows:
        return 0

    for row in rows:
        row.setdefault("collection_status", "fallback")
        row.setdefault("missing_reason", "naver_backfill")

    upserted = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        try:
            supabase.table("investor_daily").upsert(batch).execute()
            upserted += len(batch)
        except Exception:
            for j in range(0, len(batch), 50):
                sub_batch = batch[j:j + 50]
                try:
                    supabase.table("investor_daily").upsert(sub_batch).execute()
                    upserted += len(sub_batch)
                except Exception:
                    continue
    return upserted


def get_investor_range(supabase: Client) -> tuple[Optional[date], Optional[date]]:
    latest = (
        supabase.table("investor_daily")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    oldest = (
        supabase.table("investor_daily")
        .select("date")
        .order("date", desc=False)
        .limit(1)
        .execute()
    )

    latest_dt = parse_iso_date(latest.data[0]["date"]) if latest.data else None
    oldest_dt = parse_iso_date(oldest.data[0]["date"]) if oldest.data else None
    return latest_dt, oldest_dt


def get_active_codes(supabase: Client) -> list[str]:
    res = (
        supabase.table("stocks")
        .select("code")
        .in_("universe_level", ["core", "extended"])
        .eq("is_active", True)
        .execute()
    )
    return [r["code"] for r in (res.data or []) if r.get("code")]


def determine_range(
    supabase: Client,
    retention_days: int,
    explicit_start: Optional[str],
    explicit_end: Optional[str],
    fill_missing_only: bool,
) -> tuple[date, date, str]:
    today = date.today()
    end_dt = yyyymmdd_to_date(explicit_end) if explicit_end else today
    target_start = end_dt - timedelta(days=retention_days)

    if explicit_start:
        start_dt = yyyymmdd_to_date(explicit_start)
        return start_dt, end_dt, "explicit"

    _, oldest = get_investor_range(supabase)
    if not fill_missing_only:
        return target_start, end_dt, "full-window"

    if oldest is None:
        return target_start, end_dt, "missing-empty"

    if oldest <= target_start:
        return target_start, target_start, "already-covered"

    return target_start, oldest - timedelta(days=1), "missing-only"


def main() -> int:
    parser = argparse.ArgumentParser(description="investor_daily 과거 백필 (네이버 수급 페이지 기반)")
    parser.add_argument("--start", type=str, help="시작일 YYYYMMDD")
    parser.add_argument("--end", type=str, help="종료일 YYYYMMDD (기본: 오늘)")
    parser.add_argument("--retention-days", type=int, default=int(os.environ.get("INVESTOR_DAILY_RETENTION_DAYS", "400")))
    parser.add_argument("--max-pages", type=int, default=int(os.environ.get("INVESTOR_BACKFILL_MAX_PAGES", "30")))
    parser.add_argument("--sleep", type=float, default=float(os.environ.get("INVESTOR_BACKFILL_SLEEP", "0.03")))
    parser.add_argument("--full-window", action="store_true", help="기존 데이터와 무관하게 retention 전체 구간 재수집")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_env_file()
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        print("ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing", file=sys.stderr)
        return 1

    retention_days = max(400, int(args.retention_days))
    supabase: Client = create_client(supabase_url, supabase_key)

    start_dt, end_dt, mode = determine_range(
        supabase=supabase,
        retention_days=retention_days,
        explicit_start=args.start,
        explicit_end=args.end,
        fill_missing_only=not args.full_window,
    )

    if start_dt > end_dt:
        print("[investor backfill] 대상 구간 없음 (이미 목표 범위 충족)")
        return 0

    print("[investor backfill]")
    print(f"  mode={mode} retention_days={retention_days}")
    print(f"  range={date_to_yyyymmdd(start_dt)}~{date_to_yyyymmdd(end_dt)} dry_run={args.dry_run}")

    codes = get_active_codes(supabase)
    if not codes:
        print("  대상 종목 없음")
        return 1

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        }
    )

    total_rows = 0
    upserted_rows = 0
    success_codes = 0
    fail_codes = 0

    for idx, code in enumerate(codes, 1):
        if idx % 50 == 0:
            print(f"  progress {idx}/{len(codes)} success={success_codes} fail={fail_codes} rows={total_rows}")

        try:
            rows = fetch_rows_for_code(
                session=session,
                code=code,
                start_dt=start_dt,
                end_dt=end_dt,
                max_pages=max(1, args.max_pages),
                sleep_seconds=max(0.0, args.sleep),
            )
            if not rows:
                fail_codes += 1
                continue

            total_rows += len(rows)
            success_codes += 1
            if not args.dry_run:
                upserted_rows += upsert_rows(supabase, rows)
        except Exception:
            fail_codes += 1
            continue

    latest, oldest = get_investor_range(supabase)
    latest_s = latest.isoformat() if latest else "None"
    oldest_s = oldest.isoformat() if oldest else "None"
    span = (latest - oldest).days if latest and oldest else -1

    print("[investor backfill] done")
    print(
        f"  success_codes={success_codes} fail_codes={fail_codes} rows={total_rows} "
        f"upserted={upserted_rows if not args.dry_run else 0}"
    )
    print(f"  post-range latest={latest_s} oldest={oldest_s} span={span}d")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
