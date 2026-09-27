"""
batch_modules/cleanup.py
=======================
STEP 7: ??? ??? ??
"""

import os
from datetime import date, timedelta
from supabase import Client
from .utils import safe_int


# 테이블별 보존 기간(일). Supabase 무료 플랜(DB 500MB)을 감안해 다시 구할 수 없는 원본 위주로 길게 둔다.
#   - stock_daily·sector_daily: 가격 원본. 지표·엔진 점수(engine_pit)·신호는 여기서 다시 계산할 수 있다 → 3년
#   - investor_daily: 수급 원본. KIS에서 과거를 다시 받기 어렵다 → 2년
#   - scores: 학습용 시점 점수. 예전엔 보존 기한이 없어 계속 늘었다(행당 ~1KB로 가장 큼) → 2년
#   - daily_indicators·pullback_signals: stock_daily로 재계산 가능 → 기존 유지
# 대략 증가량: 유니버스 218종목 기준 연 +40~70MB. 필요하면 환경변수로 조정한다.
RETENTION_DAYS = {
    "stock_daily": ("STOCK_DAILY_RETENTION_DAYS", 1095, "date"),
    "sector_daily": ("SECTOR_DAILY_RETENTION_DAYS", 1095, "date"),
    "investor_daily": ("INVESTOR_DAILY_RETENTION_DAYS", 730, "date"),
    "scores": ("SCORES_RETENTION_DAYS", 730, "asof"),
    "daily_indicators": ("DAILY_INDICATORS_RETENTION_DAYS", 730, "trade_date"),
    "pullback_signals": ("PULLBACK_SIGNALS_RETENTION_DAYS", 400, "trade_date"),
}
MIN_RETENTION_DAYS = 400  # 52주 지표 + 엔진 200봉 요구량보다 짧아지지 않게


def resolve_retention_days(table: str) -> int:
    env_name, default, _ = RETENTION_DAYS[table]
    return max(MIN_RETENTION_DAYS, safe_int(os.environ.get(env_name, default), default))


def cleanup_old_data(supabase: Client):
    """Cleanup old rows according to retention policy."""
    print("\n[7/7] Cleaning up old data...")

    try:
        for table, (_, _, column) in RETENTION_DAYS.items():
            days = resolve_retention_days(table)
            cutoff = (date.today() - timedelta(days=days)).isoformat()
            supabase.table(table).delete().lt(column, cutoff).execute()
            print(f"  -> {table} retention: {days}d (cutoff: {cutoff})")
        try:
            jobs_cutoff = (date.today() - timedelta(days=30)).isoformat()
            supabase.table("jobs").delete()                 .in_("status", ["done", "failed"])                 .lt("created_at", jobs_cutoff).execute()
        except:
            pass
        print("   cleanup complete")
    except Exception as e:
        print(f"   cleanup failed (non-fatal): {e}")
