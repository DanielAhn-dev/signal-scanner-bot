"""Collect high-signal corporate-action disclosures from DART.

Usage:
  python scripts/collect_corporate_actions.py --days 30
"""
from __future__ import annotations

import argparse
import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests
from supabase import Client, create_client

from _env import load_env

DART_LIST_URL = "https://opendart.fss.or.kr/api/list.json"
EVENT_PATTERNS = [
    ("capital_increase", re.compile(r"유상증자|무상증자")),
    ("capital_reduction", re.compile(r"감자결정")),
    ("convertible_bond", re.compile(r"전환사채|신주인수권부사채|교환사채")),
    ("stock_split", re.compile(r"주식분할|액면분할|액면병합")),
    ("merger_split", re.compile(r"합병|분할")),
    ("major_holder", re.compile(r"최대주주변경")),
    ("trading_risk", re.compile(r"영업정지|부도|회생|파산|횡령|배임")),
]


def classify(report_name: str) -> str | None:
    name = str(report_name or "")
    if re.search(r"철회|취소", name):
        return None
    for event_type, pattern in EVENT_PATTERNS:
        if pattern.search(name):
            return event_type
    return None


def fetch_pages(api_key: str, disclosure_type: str, start: date, end: date) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    page_no = 1
    while True:
        response = requests.get(
            DART_LIST_URL,
            params={
                "crtfc_key": api_key,
                "bgn_de": start.strftime("%Y%m%d"),
                "end_de": end.strftime("%Y%m%d"),
                "pblntf_ty": disclosure_type,
                "page_no": page_no,
                "page_count": 100,
            },
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("status") == "013":
            break
        if payload.get("status") != "000":
            raise RuntimeError(f"DART {payload.get('status')}: {payload.get('message')}")
        items.extend(payload.get("list") or [])
        if page_no >= int(payload.get("total_page") or 1) or page_no >= 50:
            break
        page_no += 1
    return items


def fetch_actions(api_key: str, days: int) -> list[dict[str, Any]]:
    end = date.today()
    start = end - timedelta(days=days)
    rows: list[dict[str, Any]] = []
    # B: 주요사항보고(증자·CB·합병·감자), I: 거래소공시(최대주주변경·영업정지·횡령배임)
    for disclosure_type in ("B", "I"):
        for item in fetch_pages(api_key, disclosure_type, start, end):
            code = str(item.get("stock_code") or "").strip()
            report_name = str(item.get("report_nm") or "").strip()
            rcept_no = str(item.get("rcept_no") or "").strip()
            rcept_dt = str(item.get("rcept_dt") or "").strip()
            event_type = classify(report_name)
            if not re.fullmatch(r"\d{6}", code) or not event_type or not rcept_no or not re.fullmatch(r"\d{8}", rcept_dt):
                continue
            rows.append(
                {
                    "rcept_no": rcept_no,
                    "code": code,
                    "event_date": f"{rcept_dt[:4]}-{rcept_dt[4:6]}-{rcept_dt[6:8]}",
                    "event_type": event_type,
                    "report_name": report_name,
                    "source": "dart_list",
                    "available_at": f"{rcept_dt[:4]}-{rcept_dt[4:6]}-{rcept_dt[6:8]}T23:59:59+09:00",
                    "raw": item,
                }
            )
    return list({row["rcept_no"]: row for row in rows}.values())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30)
    args = parser.parse_args()
    load_env()
    api_key = str(os.environ.get("DART_API_KEY", "")).strip()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not api_key:
        raise RuntimeError("DART_API_KEY가 없습니다")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다")
    rows = fetch_actions(api_key, max(1, min(args.days, 365)))
    if rows:
        supabase: Client = create_client(url, key)
        supabase.table("corporate_actions").upsert(rows, on_conflict="rcept_no").execute()
    print(f"corporate actions 저장: {len(rows)}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
