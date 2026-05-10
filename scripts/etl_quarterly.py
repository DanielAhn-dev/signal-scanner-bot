# -*- coding: utf-8 -*-
"""
scripts/etl_quarterly.py
========================
m.stock.naver.com/api/stock/{code}/finance/summary 에서
분기별 매출 / 영업이익 / EPS를 수집해 fundamentals 테이블에 upsert.

사용법:
  python scripts/etl_quarterly.py              # 전체 KRX 종목
  python scripts/etl_quarterly.py 005930 000660  # 특정 종목
  python scripts/etl_quarterly.py --limit 50   # 최대 50개
"""
from __future__ import annotations

import json
import calendar
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests


def _load_env(filepath: str = ".env") -> None:
    try:
        with open(filepath) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() not in os.environ:
                    os.environ[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass


_load_env()

try:
    from supabase import create_client
    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
except Exception as e:
    print(f"Supabase init 실패: {e}")
    sys.exit(1)

UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
)
_session = requests.Session()
_session.headers.update({
    "User-Agent": UA,
    "Referer": "https://m.stock.naver.com/",
    "Accept-Language": "ko-KR,ko;q=0.9",
})

FINANCE_SUMMARY_URL = "https://m.stock.naver.com/api/stock/{code}/finance/summary"
_trend_table_missing_warned = False


def _last_day_of_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _safe_int(val) -> Optional[int]:
    if val is None:
        return None
    try:
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def _quarter_to_date(key: str) -> str:
    """'202506' -> '2025-06-30', '202602' -> '2026-02-28'"""
    year = int(key[:4])
    month = int(key[4:6])
    day = _last_day_of_month(year, month)
    return f"{year}-{month:02d}-{day:02d}"


def fetch_quarterly(code: str) -> list[dict]:
    url = FINANCE_SUMMARY_URL.format(code=code)
    try:
        r = _session.get(url, timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  [{code}] fetch 실패: {e}")
        return []

    if not isinstance(data, dict):
        return []

    qs = (data.get("chartIncomeStatement") or {}).get("quarter", {})
    cols = qs.get("columns", [])
    titles = qs.get("trTitleList", [])
    if not cols or len(cols) < 3:
        return []

    keys = [t["key"] for t in titles]
    revenues = cols[1][1:] if len(cols) > 1 else []
    op_incs = cols[2][1:] if len(cols) > 2 else []
    consensus = {t["key"]: t.get("isConsensus") == "Y" for t in titles}

    eps_titles = (data.get("chartEps") or {}).get("trTitleList", [])
    eps_cols = (data.get("chartEps") or {}).get("columns", [])
    eps_map: dict[str, Optional[int]] = {}
    if eps_cols and len(eps_cols) > 1:
        for ev, et in zip(eps_cols[1][1:], eps_titles):
            eps_map[et.get("key", "")] = _safe_int(ev)

    result = []
    for i, qkey in enumerate(keys):
        pd = _quarter_to_date(qkey)
        result.append({
            "code": code,
            "period_end": pd,
            "period_type": "quarter",
            "as_of": f"{pd}T00:00:00+09:00",
            "sales": _safe_int(revenues[i] if i < len(revenues) else None),
            "operating_income": _safe_int(op_incs[i] if i < len(op_incs) else None),
            "eps": eps_map.get(qkey),
            "source": "naver-mobile-api",
            "computed": {
                "is_consensus": consensus.get(qkey, False),
                "quarter_key": qkey,
            },
        })
    return result


def _compute_qoq(records: list[dict]) -> list[dict]:
    recs = sorted(records, key=lambda r: (r.get("computed") or {}).get("quarter_key", ""))
    for i, rec in enumerate(recs):
        prev = recs[i - 1] if i > 0 else None
        c = rec.get("computed") or {}
        rev = rec.get("sales")
        op = rec.get("operating_income")
        if prev and rev and prev.get("sales") and prev["sales"] != 0:
            c["rev_qoq"] = round((rev - prev["sales"]) / abs(prev["sales"]) * 100, 2)
        if prev and op and prev.get("operating_income") and prev["operating_income"] != 0:
            c["op_qoq"] = round((op - prev["operating_income"]) / abs(prev["operating_income"]) * 100, 2)
        if i >= 2:
            pc = recs[i - 1].get("computed") or {}
            if "rev_qoq" in c and "rev_qoq" in pc:
                c["rev_acceleration"] = round(c["rev_qoq"] - pc["rev_qoq"], 2)
            if "op_qoq" in c and "op_qoq" in pc:
                c["op_acceleration"] = round(c["op_qoq"] - pc["op_qoq"], 2)
        rec["computed"] = c
    return recs


def upsert_records(records: list[dict]) -> int:
    if not records:
        return 0
    try:
        supabase.table("fundamentals").upsert(records, on_conflict="code,as_of").execute()
        return len(records)
    except Exception as e:
        print(f"  upsert 에러: {e}")
        return 0


def build_trend_records(records: list[dict]) -> list[dict]:
    now_iso = datetime.now(timezone.utc).isoformat()
    trends: list[dict] = []
    for rec in records:
        computed = rec.get("computed") or {}
        trends.append({
            "code": rec.get("code"),
            "period_end": rec.get("period_end"),
            "quarter_key": computed.get("quarter_key"),
            "is_consensus": bool(computed.get("is_consensus", False)),
            "sales": rec.get("sales"),
            "operating_income": rec.get("operating_income"),
            "eps": rec.get("eps"),
            "rev_qoq": computed.get("rev_qoq"),
            "op_qoq": computed.get("op_qoq"),
            "rev_acceleration": computed.get("rev_acceleration"),
            "op_acceleration": computed.get("op_acceleration"),
            "source": rec.get("source") or "naver-mobile-api",
            "computed": computed,
            "updated_at": now_iso,
        })
    return trends


def upsert_trend_records(records: list[dict]) -> int:
    global _trend_table_missing_warned
    if not records:
        return 0
    try:
        supabase.table("fundamental_trends").upsert(
            records,
            on_conflict="code,period_end",
        ).execute()
        return len(records)
    except Exception as e:
        msg = str(e)
        missing_signatures = (
            ("fundamental_trends" in msg and "does not exist" in msg)
            or "PGRST205" in msg
            or "schema cache" in msg
        )
        if missing_signatures:
            if not _trend_table_missing_warned:
                print("  fundamental_trends 테이블이 없어 스킵합니다. (마이그레이션 적용 필요)")
                _trend_table_missing_warned = True
            return 0
        print(f"  fundamental_trends upsert 에러: {e}")
        return 0


def load_all_codes(limit: Optional[int] = None) -> list[str]:
    fpath = Path(__file__).parent.parent / "data" / "all_krx.json"
    try:
        codes = [s["code"] for s in json.loads(fpath.read_text("utf-8"))]
        return codes[:limit] if limit else codes
    except Exception as e:
        print(f"all_krx.json 로드 실패: {e}")
        return []


def main() -> None:
    args = sys.argv[1:]
    limit: Optional[int] = None
    codes: list[str] = []
    i = 0
    while i < len(args):
        if args[i] == "--limit" and i + 1 < len(args):
            limit = int(args[i + 1])
            i += 2
        elif not args[i].startswith("--"):
            codes.append(args[i])
            i += 1
        else:
            i += 1

    if not codes:
        codes = load_all_codes(limit)
    if not codes:
        print("종목 코드 없음.")
        return

    print(f"분기별 재무 수집 시작: {len(codes)}개 종목")
    total_saved = 0
    total_trends_saved = 0
    total_ok = 0

    for idx, code in enumerate(codes):
        if idx % 100 == 0 and idx > 0:
            print(f"  진행: {idx}/{len(codes)} (저장: {total_saved}개)")
        records = fetch_quarterly(code)
        if records:
            records = _compute_qoq(records)
            total_saved += upsert_records(records)
            total_trends_saved += upsert_trend_records(build_trend_records(records))
            total_ok += 1
        time.sleep(0.2)

    print(
        f"\n완료: {total_ok}/{len(codes)}개 종목 성공, "
        f"fundamentals {total_saved}개 / fundamental_trends {total_trends_saved}개 저장"
    )


if __name__ == "__main__":
    main()
