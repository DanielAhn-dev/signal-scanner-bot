"""
stocks.product_type·etf_category·etf_tax_class를 지금 바로 맞춘다 (일일 배치 [8/8] 스냅샷 단계와 같은 동작).

  python scripts/sync_product_types.py --dry-run   # 바뀔 행 수·예시만 출력
  python scripts/sync_product_types.py             # 실제 반영 (apply_stock_product_types RPC, db/migrations/036)

장중에도 돌려도 된다 — 시세가 아니라 상품 유형만 쓴다.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from supabase import Client, create_client

from _env import load_env
from batch_modules.market_snapshot import fetch_market_rows, sync_product_types


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync stocks product type / ETF tax class from Naver")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    load_env()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다")
    rows: list[dict] = []
    for market in ("KOSPI", "KOSDAQ"):
        market_rows, _, _ = fetch_market_rows(market)
        rows.extend(market_rows)
    print(f"snapshot rows: {len(rows)}")
    if len(rows) < 1000:
        print("too few rows — 중단")
        return 1
    supabase: Client = create_client(url, key)
    changed = sync_product_types(supabase, rows, dry_run=args.dry_run)
    return 0 if changed >= 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
