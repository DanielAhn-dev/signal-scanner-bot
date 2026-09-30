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
import re
import sys
import time
from datetime import datetime, timedelta, timezone
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
DART_LIST_URL = "https://opendart.fss.or.kr/api/list.json"
_trend_table_missing_warned = False
_dart_corp_codes: Optional[dict[str, str]] = None
_dart_filing_cache: dict[tuple[str, str], Optional[str]] = {}


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


def _load_dart_corp_codes() -> dict[str, str]:
    global _dart_corp_codes
    if _dart_corp_codes is not None:
        return _dart_corp_codes
    path = Path(__file__).parent.parent / "src" / "data" / "dartCorpCodes.json"
    try:
        raw = json.loads(path.read_text("utf-8"))
        _dart_corp_codes = {str(k): str(v) for k, v in raw.items()}
    except Exception as e:
        print(f"  DART 회사코드 표 로드 실패: {e}")
        _dart_corp_codes = {}
    return _dart_corp_codes


def _matches_period_report(report_name: str, end_date) -> bool:
    """DART report name이 대상 회계기간을 가리키는지 확인한다."""
    name = str(report_name or "")
    year = str(end_date.year)
    month = int(end_date.strftime("%m"))
    if year not in name or not re.search(r"분기보고서|반기보고서|사업보고서", name):
        return False
    period_key = end_date.strftime("%Y%m")
    digits = re.sub(r"[^0-9]", "", name)
    if period_key in digits:
        return True
    if month == 3:
        return bool(re.search(r"1\s*분기", name))
    if month == 6:
        return bool(re.search(r"2\s*분기|반기", name))
    if month == 9:
        return bool(re.search(r"3\s*분기", name))
    if month == 12:
        return bool(re.search(r"사업보고서|4\s*분기", name))
    return False


def _dart_filing_date(code: str, period_end: str) -> Optional[str]:
    """분기말과 보고서 기간이 일치하는 DART 접수일을 반환한다.

    DART 보강은 선택 기능이다. 공시일을 찾지 못하면 None을 반환해
    collection_time 기준으로 안전하게 남긴다.
    """
    cache_key = (code, period_end)
    if cache_key in _dart_filing_cache:
        return _dart_filing_cache[cache_key]
    api_key = str(os.environ.get("DART_API_KEY", "")).strip()
    corp_code = _load_dart_corp_codes().get(code)
    if not api_key or not corp_code:
        _dart_filing_cache[cache_key] = None
        return None
    try:
        end_date = datetime.strptime(period_end, "%Y-%m-%d").date()
        bgn_de = (end_date - timedelta(days=15)).strftime("%Y%m%d")
        end_de = (end_date + timedelta(days=150)).strftime("%Y%m%d")
        response = _session.get(
            DART_LIST_URL,
            params={
                "crtfc_key": api_key,
                "corp_code": corp_code,
                "bgn_de": bgn_de,
                "end_de": end_de,
                "pblntf_ty": "A",
                "page_no": 1,
                "page_count": 100,
            },
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("status") != "000":
            _dart_filing_cache[cache_key] = None
            return None
        candidates: list[str] = []
        for item in payload.get("list") or []:
            report_name = str(item.get("report_nm") or "")
            if not _matches_period_report(report_name, end_date):
                continue
            receipt = str(item.get("rcept_dt") or "")
            # 분기말 당일 접수도 유효한 데이터로 허용한다.
            if re.fullmatch(r"\d{8}", receipt) and receipt >= end_date.strftime("%Y%m%d"):
                candidates.append(receipt)
        if not candidates:
            _dart_filing_cache[cache_key] = None
            return None
        receipt = min(candidates)
        value = f"{receipt[:4]}-{receipt[4:6]}-{receipt[6:8]}T23:59:59+09:00"
        _dart_filing_cache[cache_key] = value
        return value
    except Exception as e:
        print(f"  [{code} {period_end}] DART 접수일 조회 실패: {e}")
        _dart_filing_cache[cache_key] = None
        return None


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

    collected_at = datetime.now(timezone.utc).isoformat()
    enrich_with_dart = str(os.environ.get("DART_PIT_ENRICH", "false")).lower() in ("1", "true", "yes")
    result = []
    for i, qkey in enumerate(keys):
        pd = _quarter_to_date(qkey)
        filing_date = _dart_filing_date(code, pd) if enrich_with_dart else None
        available_at = filing_date or collected_at
        availability_basis = "filing_date" if filing_date else "collection_time"
        result.append({
            "code": code,
            "period_end": pd,
            "period_type": "quarter",
            "as_of": f"{pd}T00:00:00+09:00",
            "available_at": available_at,
            "availability_basis": availability_basis,
            "sales": _safe_int(revenues[i] if i < len(revenues) else None),
            "operating_income": _safe_int(op_incs[i] if i < len(op_incs) else None),
            "eps": eps_map.get(qkey),
            "source": "naver-mobile-api",
            "computed": {
                "is_consensus": consensus.get(qkey, False),
                "quarter_key": qkey,
                "availability_basis": availability_basis,
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
            "available_at": rec.get("available_at"),
            "availability_basis": rec.get("availability_basis") or "collection_time",
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
