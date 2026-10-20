#!/usr/bin/env python3
"""
stocks.name이 종목코드로 저장된 행(name == code)을 네이버 모바일 시세 목록의 종목명으로 채운다(1회 복구).

유니버스 갱신이 pykrx 이름 조회 실패 때 코드를 써 넣어 생긴 행이다(2026-10-20 473개, 원인은
refresh_universe_membership.resolve_stock_name으로 수정). 일일 배치도 같은 함수(repair_code_names)로 자가복구한다.
네이버 목록에 없는 행은 건드리지 않는다. --per-code를 주면 목록(코스피·코스닥)에 없는 행을 종목별 기본 정보
API로 한 번 더 찾는다 — 2026-10-20 남은 133행 대부분이 거래 중인 코넥스 종목이었다(나머지는 StockConflict, 상장폐지 추정).

  python scripts/repair_code_names.py --dry-run              # 바뀔 행 수·예시만
  python scripts/repair_code_names.py                        # 실제 반영 (운영 DB — 드라이런 확인 후)
  python scripts/repair_code_names.py --per-code --dry-run   # 코넥스 등 목록 밖 종목까지
"""
import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import requests  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from supabase import create_client  # noqa: E402

from batch_modules.market_snapshot import (  # noqa: E402
    HEADERS,
    _fetch_current_names,
    build_name_repairs,
    fetch_market_rows,
    repair_code_names,
)

BASIC_API = "https://m.stock.naver.com/api/stock/{code}/basic"


def fetch_basic_rows(codes: list[str], sleep_sec: float = 0.25) -> list[dict]:
    """종목별 기본 정보 → [{code, name}]. 못 찾은 종목(상장폐지 등은 409 StockConflict)은 뺀다."""
    out: list[dict] = []
    for code in codes:
        try:
            r = requests.get(BASIC_API.format(code=code), headers=HEADERS, timeout=10)
            if r.ok:
                name = str(r.json().get("stockName") or "").strip()
                if name:
                    out.append({"code": code, "name": name})
        except Exception as e:
            print(f"   basic lookup failed {code}: {e}")
        time.sleep(sleep_sec)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="쓰지 않고 바뀔 행만 출력")
    parser.add_argument("--per-code", action="store_true", help="목록에 없는 행을 종목별 API로 한 번 더 찾기")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    load_dotenv(root / ".env.local")
    load_dotenv(root / ".env")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("[ERROR] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing")
        return 1

    rows: list[dict] = []
    for market in ("KOSPI", "KOSDAQ"):
        market_rows, _, _ = fetch_market_rows(market)
        rows.extend(market_rows)
    print(f"naver rows: {len(rows)}")
    if len(rows) < 1000:
        print("[ERROR] too few rows from naver — aborting")
        return 1

    supabase = create_client(url, key)
    if args.per_code:
        current = _fetch_current_names(supabase)
        if current is None:
            return 1
        _, missing = build_name_repairs(rows, current)
        extra = fetch_basic_rows(missing)
        print(f"per-code lookup: {len(extra)} of {len(missing)} found")
        rows.extend(extra)

    result = repair_code_names(supabase, rows, dry_run=args.dry_run)
    print(f"{'[dry-run] would change' if args.dry_run else 'changed'}: {result}")
    return 0 if result >= 0 else 1


if __name__ == "__main__":
    sys.exit(main())
