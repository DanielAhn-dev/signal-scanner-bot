#!/usr/bin/env python3
"""
stocks.name이 종목코드로 저장된 행(name == code)을 네이버 모바일 시세 목록의 종목명으로 채운다(1회 복구).

유니버스 갱신이 pykrx 이름 조회 실패 때 코드를 써 넣어 생긴 행이다(2026-10-20 473개, 원인은
refresh_universe_membership.resolve_stock_name으로 수정). 일일 배치도 같은 함수(repair_code_names)로 자가복구한다.
네이버 목록에 없는 행(상장폐지 등)은 건드리지 않는다.

  python scripts/repair_code_names.py --dry-run   # 바뀔 행 수·예시만
  python scripts/repair_code_names.py             # 실제 반영 (운영 DB — 드라이런 확인 후)
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv  # noqa: E402
from supabase import create_client  # noqa: E402

from batch_modules.market_snapshot import fetch_market_rows, repair_code_names  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="쓰지 않고 바뀔 행만 출력")
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

    result = repair_code_names(create_client(url, key), rows, dry_run=args.dry_run)
    print(f"{'[dry-run] would change' if args.dry_run else 'changed'}: {result}")
    return 0 if result >= 0 else 1


if __name__ == "__main__":
    sys.exit(main())
