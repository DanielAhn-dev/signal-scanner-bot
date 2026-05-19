#!/usr/bin/env python3
"""
scripts/monitor_data_retention.py
==================================
데이터 보유 정책 검증 및 모니터링

용도:
  1. 각 테이블 최신/최구 데이터 확인
  2. 보유 기간 검증 (400일, 730일 등)
  3. 데이터 손실 경고
  4. 정기 모니터링용

사용법:
  python scripts/monitor_data_retention.py
  python scripts/monitor_data_retention.py --show-counts  # 행 개수까지 확인
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta
from typing import Optional
import argparse

from supabase import create_client, Client


# ===== 환경 변수 설정 =====
def load_env_file(filepath: str = ".env") -> None:
    try:
        with open(filepath, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    key = key.strip()
                    if key not in os.environ:
                        os.environ[key] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass


load_env_file()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("🚨 ERROR: SUPABASE_URL or SERVICE_ROLE_KEY missing", file=sys.stderr)
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ===== 정책 정의 =====
RETENTION_POLICY = {
    "stock_daily": {
        "date_column": "date",
        "retention_days": 400,
        "description": "OHLCV 데이터 (400일 = ~1.6년 거래일)",
    },
    "daily_indicators": {
        "date_column": "trade_date",
        "retention_days": int(os.environ.get("DAILY_INDICATORS_RETENTION_DAYS", 730)),
        "description": "기술적 지표 SMA/RSI/ROC (기본 730일 = 2년)",
    },
    "investor_daily": {
        "date_column": "date",
        "retention_days": 400,
        "description": "투자자 수급 데이터 (400일)",
    },
    "sector_daily": {
        "date_column": "date",
        "retention_days": 400,
        "description": "섹터 등락률 데이터 (400일)",
    },
    "pullback_signals": {
        "date_column": "trade_date",
        "retention_days": 400,
        "description": "눌림목 신호 (400일)",
    },
}


# ===== 유틸리티 =====
def get_date_range(
    supabase: Client, table: str, date_column: str
) -> tuple[Optional[str], Optional[str], int]:
    """테이블에서 최신/최구 날짜 및 행 개수 조회"""
    try:
        # 최신 날짜
        latest_res = supabase.table(table).select(date_column, count="exact").order(
            date_column, desc=True
        ).limit(1).execute()

        if not latest_res.data:
            return None, None, 0

        latest = latest_res.data[0][date_column]
        count = latest_res.count or 0

        # 최구 날짜
        oldest_res = supabase.table(table).select(date_column).order(
            date_column, desc=False
        ).limit(1).execute()
        oldest = oldest_res.data[0][date_column] if oldest_res.data else None

        return latest, oldest, count
    except Exception as e:
        print(f"  ❌ 조회 실패: {e}")
        return None, None, 0


def calculate_days_diff(date_str: str, ref_date: Optional[date] = None) -> int:
    """날짜 문자열 → 오늘로부터 일수 계산"""
    if ref_date is None:
        ref_date = date.today()

    try:
        if isinstance(date_str, str):
            parsed_date = datetime.fromisoformat(date_str).date()
        else:
            parsed_date = date_str
        return (ref_date - parsed_date).days
    except:
        return -1


def check_retention_health(
    table: str,
    latest: Optional[str],
    oldest: Optional[str],
    retention_days: int,
    show_counts: bool = False,
    count: int = 0,
) -> bool:
    """보유 정책 준수 여부 판단"""
    if not latest or not oldest:
        print(f"  ⚠️  데이터 없음")
        return False

    days_from_latest = calculate_days_diff(latest)
    days_from_oldest = calculate_days_diff(oldest)
    span = days_from_oldest - days_from_latest  # 최구가 최신보다 더 예전이므로 그 차이

    # 판정
    is_fresh = days_from_latest <= 5
    is_within_retention = span >= retention_days - 10  # 10일 여유

    status = "✅" if (is_fresh and is_within_retention) else "⚠️"

    info = f"최신: {latest} ({days_from_latest}일전) | 최구: {oldest} ({days_from_oldest}일전) | 범위: {span}일"
    if show_counts:
        info += f" | 행: {count:,}"
    print(f"  {status} {info}")

    if not is_fresh:
        print(f"      🔔 경고: 데이터가 {days_from_latest}일 오래됨 (5일 이내 권장)")
    if not is_within_retention:
        print(f"      🔔 경고: 보유 기간 미달 ({span}일 < {retention_days}일 목표)")

    return is_fresh and is_within_retention


# ===== 메인 =====
def main():
    parser = argparse.ArgumentParser(description="데이터 보유 정책 모니터링")
    parser.add_argument(
        "--show-counts",
        action="store_true",
        help="각 테이블 행 개수도 함께 표시",
    )
    args = parser.parse_args()

    print("=" * 80)
    print("📊 데이터 보유 정책 모니터링")
    print("=" * 80)
    print()

    today = date.today()
    print(f"기준일: {today.isoformat()}")
    print()

    all_healthy = True

    for table, policy in RETENTION_POLICY.items():
        print(f"📋 {table}")
        print(f"   {policy['description']}")

        latest, oldest, count = get_date_range(supabase, table, policy["date_column"])

        is_healthy = check_retention_health(
            table,
            latest,
            oldest,
            policy["retention_days"],
            show_counts=args.show_counts,
            count=count,
        )

        if not is_healthy:
            all_healthy = False

        print()

    print("=" * 80)
    if all_healthy:
        print("✅ 모든 테이블이 정책을 준수합니다")
    else:
        print("⚠️  일부 테이블이 정책을 벗어났습니다. 확인 필요!")
    print("=" * 80)

    return 0 if all_healthy else 1


if __name__ == "__main__":
    sys.exit(main())
