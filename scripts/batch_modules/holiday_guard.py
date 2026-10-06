"""
batch_modules/holiday_guard.py
==============================
휴장 평일(대체공휴일·한글날 등) 재실행 방지.

일일 배치는 평일마다 예약돼 있어 휴장 평일에도 돈다. 그러면 직전 거래일을 처음부터 다시 처리해
(1) 이미 기록된 점수·신호를 재계산으로 덮고 (2) 신용/공매도를 다시 받아 적재 행이 줄고
(3) 60분 한도 안에서 25분 이상을 쓴다 (2026-10-05 대체공휴일: 10/02 점수 216행이 legacy_fallback으로 강등).
배치 기준일이 휴장일이고 직전 거래일 처리가 이미 끝났으면 건너뛴다. --date / --force 로 강제 실행할 수 있다.
"""

from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo

from .utils import is_krx_trading_day

# GitHub 스케줄 지연(4~9시간)으로 배치가 자정을 넘겨 시작해도 전날 배치로 본다 (src/services/batchVerifyDay.ts와 같은 기준)
BATCH_LAG_HOURS = 8
# 직전 거래일 일봉 대비 이만큼 이상 점수가 있으면 처리 완료로 본다
DONE_SCORE_RATIO = 0.8


def resolve_batch_day(now: datetime | None = None) -> date:
    """배치가 처리해야 하는 날짜(KST). 새벽 시작은 전날 배치로 본다."""
    now = now or datetime.now(ZoneInfo("Asia/Seoul"))
    return (now.astimezone(ZoneInfo("Asia/Seoul")) - timedelta(hours=BATCH_LAG_HOURS)).date()


def is_processed(price_rows: int, score_rows: int, signal_rows: int) -> bool:
    """그 거래일의 일봉·점수·눌림목 신호가 모두 적재돼 있으면 True."""
    return price_rows > 0 and signal_rows > 0 and score_rows >= price_rows * DONE_SCORE_RATIO


def _count(supabase, table: str, column: str, value: str) -> int:
    res = supabase.table(table).select(column, count="exact").eq(column, value).limit(1).execute()
    return int(res.count or 0)


def should_skip_holiday_rerun(supabase, trading_iso: str, now: datetime | None = None) -> tuple[bool, str]:
    """(건너뛸지, 사유). 배치 기준일이 거래일이면 언제나 실행한다."""
    batch_day = resolve_batch_day(now)
    if is_krx_trading_day(batch_day):
        return False, ""
    try:
        prices = _count(supabase, "stock_daily", "date", trading_iso)
        scores = _count(supabase, "scores", "asof", trading_iso)
        signals = _count(supabase, "pullback_signals", "trade_date", trading_iso)
    except Exception as e:
        # 확인을 못 하면 예전처럼 실행한다(누락보다 재처리가 낫다)
        return False, f"처리 여부 확인 실패: {e}"
    if is_processed(prices, scores, signals):
        return True, f"배치 기준일 {batch_day} 휴장 · {trading_iso} 이미 처리됨(일봉 {prices} · 점수 {scores} · 신호 {signals})"
    return False, f"배치 기준일 {batch_day} 휴장이지만 {trading_iso} 처리가 덜 됨(일봉 {prices} · 점수 {scores} · 신호 {signals}) → 실행"
