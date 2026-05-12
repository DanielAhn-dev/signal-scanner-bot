"""
Generate per-symbol credit/short upload CSV template for manual web upload.

Output columns:
  code,date,shortRatio,creditRatio

Usage:
  python scripts/generate_credit_short_upload_csv.py --date 2026-05-12
  python scripts/generate_credit_short_upload_csv.py --date 2026-05-12 --output tmp/credit_short_upload_2026-05-12.csv
  python scripts/generate_credit_short_upload_csv.py --date 2026-05-12 --prefill-latest
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from datetime import datetime
from typing import Any

from supabase import Client, create_client


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate credit/short upload CSV template")
    parser.add_argument("--date", required=True, help="Target date (YYYY-MM-DD or YYYYMMDD)")
    parser.add_argument(
        "--output",
        default="",
        help="Output CSV path (default: tmp/credit_short_upload_<date>.csv)",
    )
    parser.add_argument(
        "--prefill-latest",
        action="store_true",
        help="Prefill shortRatio/creditRatio from stocks.latest values",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional row limit for quick testing",
    )
    return parser.parse_args()


def normalize_date(raw: str) -> str:
    raw = raw.strip()
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
    try:
        parsed = datetime.strptime(raw, "%Y-%m-%d")
        return parsed.strftime("%Y-%m-%d")
    except ValueError:
        raise ValueError("--date must be YYYY-MM-DD or YYYYMMDD")


def load_env_file(filepath: str = ".env") -> None:
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except FileNotFoundError:
        pass


def get_supabase() -> Client:
    load_env_file()
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is required")
    return create_client(url, key)


def fetch_active_stocks(supabase: Client, prefill_latest: bool, limit: int) -> list[dict[str, Any]]:
    select_cols = "code"
    if prefill_latest:
        select_cols = "code,short_ratio,credit_ratio"

    query = (
        supabase.table("stocks")
        .select(select_cols)
        .eq("is_active", True)
        .in_("universe_level", ["core", "extended"])
        .order("code")
    )
    if limit > 0:
        query = query.limit(limit)

    res = query.execute()
    rows = res.data or []
    out: list[dict[str, Any]] = []
    for row in rows:
        code = str(row.get("code") or "").strip()
        if len(code) == 6 and code.isdigit():
            out.append(row)
    return out


def main() -> int:
    args = parse_args()
    try:
        target_date = normalize_date(args.date)
    except ValueError as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1

    output_path = args.output or f"tmp/credit_short_upload_{target_date}.csv"
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    try:
        supabase = get_supabase()
        stocks = fetch_active_stocks(supabase, args.prefill_latest, args.limit)
    except Exception as e:
        print(f"[ERROR] Failed to prepare data: {e}", file=sys.stderr)
        return 1

    if not stocks:
        print("[WARN] No active stocks found")
        return 1

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["code", "date", "shortRatio", "creditRatio"])
        for row in stocks:
            short_ratio = row.get("short_ratio") if args.prefill_latest else ""
            credit_ratio = row.get("credit_ratio") if args.prefill_latest else ""
            writer.writerow([row["code"], target_date, short_ratio if short_ratio is not None else "", credit_ratio if credit_ratio is not None else ""])

    print(f"[OK] Generated: {output_path}")
    print(f"[OK] Rows: {len(stocks)}")
    if not args.prefill_latest:
        print("[INFO] shortRatio/creditRatio are empty. Fill values and upload in web modal.")
    else:
        print("[INFO] shortRatio/creditRatio prefilled from stocks.latest values.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
