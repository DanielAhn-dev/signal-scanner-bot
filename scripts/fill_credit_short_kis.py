"""
scripts/fill_credit_short_kis.py
================================
KRX가 막혔을 때 신용/공매도 누락분을 한국투자증권 API로 채운다(거래량·신용잔고율만, 잔고는 KRX 전용).
이미 ok인 행은 건드리지 않고, KRX로 받은 잔고 값은 보존한다.

사용법:
  python scripts/fill_credit_short_kis.py --start 20260928 --end 20261002
"""
import os
import sys
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from supabase import create_client
from batch_modules.utils import is_krx_trading_day
from datetime import datetime, timedelta


def load_env(path: str = ".env") -> None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


def main() -> int:
    load_env()
    parser = argparse.ArgumentParser(description="신용/공매도 KIS 보조 채우기")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    args = parser.parse_args()

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL / SERVICE_ROLE_KEY 없음", file=sys.stderr)
        return 1
    supabase = create_client(url, key)

    days, cur = [], datetime.strptime(args.start, "%Y%m%d").date()
    end = datetime.strptime(args.end, "%Y%m%d").date()
    while cur <= end:
        if is_krx_trading_day(cur):
            days.append(cur.strftime("%Y%m%d"))
        cur += timedelta(days=1)
    res = (
        supabase.table("stocks").select("code")
        .in_("universe_level", ["core", "extended"]).eq("is_active", True).execute()
    )
    codes = [r["code"] for r in (res.data or [])]
    print(f"거래일 {days}, 대상 {len(codes)}종목")

    from batch_modules.kis_credit_short import fill_with_kis
    result = fill_with_kis(supabase, days[0], days[-1], codes, days)
    print("결과:", result)
    return 0 if result.get("filled", 0) > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
