"""
batch_modules/market_investor_flow.py
=====================================
코스피 시장 전체 투자자별 일별 순매수(억원)를 market_breadth_daily에 쌓는다.

종목별 수급(investor_daily)은 유니버스 218종목 합계라 시장 전체 외국인 매도 규모를 대신하지 못한다.
'신고가 부근인데 외국인 60일 순매도가 1년 중 최대 수준' 경고(src/services/marketFlowCaution.ts)는
최근 310거래일 이상이 필요해, 빠진 날을 자동으로 채운다(첫 실행 약 330회 요청·2~3분, 이후 하루 1~2회).

  출처: 네이버 증권 모바일 API (인증 불필요)
    거래일 목록: /api/index/KOSPI/price?pageSize=60&page=N
    수급:        /api/index/KOSPI/trend?bizdate=YYYYMMDD  → personalValue·foreignValue·institutionalValue (억원)
  저장: market_breadth_daily (market='KOSPI', universe_level='market_investor', source='naver_index_trend')
        foreign_net·institution_net 컬럼을 쓰고, 개인은 personal_net 컬럼이 없어 저장하지 않는다.
"""

import time

import requests

PRICE_API = "https://m.stock.naver.com/api/index/KOSPI/price?pageSize=60&page={page}"
TREND_API = "https://m.stock.naver.com/api/index/KOSPI/trend?bizdate={bizdate}"
HEADERS = {"User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"}
UNIVERSE_LEVEL = "market_investor"
LOOKBACK_TRADING_DAYS = 330


def _num(value):
    s = str(value or "").replace(",", "").replace("+", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def fetch_recent_trading_dates(days: int = LOOKBACK_TRADING_DAYS) -> list[str]:
    """최근 거래일(YYYY-MM-DD), 오래된 것부터."""
    dates: list[str] = []
    page = 1
    while len(dates) < days and page <= 20:
        res = requests.get(PRICE_API.format(page=page), headers=HEADERS, timeout=15)
        res.raise_for_status()
        rows = res.json() or []
        if not rows:
            break
        dates.extend(str(r.get("localTradedAt") or "")[:10] for r in rows if r.get("localTradedAt"))
        page += 1
        time.sleep(0.2)
    return sorted(set(dates))[-days:]


def fetch_trend(trade_date: str) -> dict | None:
    bizdate = trade_date.replace("-", "")
    res = requests.get(TREND_API.format(bizdate=bizdate), headers=HEADERS, timeout=15)
    res.raise_for_status()
    j = res.json() or {}
    # 휴장일·미래 날짜는 직전 거래일을 돌려준다 → 요청한 날짜와 다르면 버린다
    if str(j.get("bizdate")) != bizdate:
        return None
    foreign = _num(j.get("foreignValue"))
    institution = _num(j.get("institutionalValue"))
    if foreign is None or institution is None:
        return None
    return {"foreign_net": foreign, "institution_net": institution}


def collect_market_investor_flow(supabase) -> dict:
    try:
        dates = fetch_recent_trading_dates()
    except Exception as e:
        print(f"   [WARN] 코스피 거래일 목록 조회 실패: {e}")
        return {"ok": False, "reason": "price_api_failed"}
    if not dates:
        return {"ok": False, "reason": "no_trading_dates"}

    existing = (
        supabase.table("market_breadth_daily")
        .select("trade_date")
        .eq("market", "KOSPI")
        .eq("universe_level", UNIVERSE_LEVEL)
        .gte("trade_date", dates[0])
        .limit(2000)
        .execute()
    )
    have = {str(r["trade_date"])[:10] for r in (existing.data or [])}
    # 마지막 날은 장중 수집분일 수 있어 항상 다시 받는다
    missing = [d for d in dates if d not in have or d == dates[-1]]

    records = []
    failed = 0
    for d in missing:
        try:
            trend = fetch_trend(d)
        except Exception:
            trend = None
        if trend is None:
            failed += 1
        else:
            records.append({
                "trade_date": d,
                "market": "KOSPI",
                "universe_level": UNIVERSE_LEVEL,
                "foreign_net": trend["foreign_net"],
                "institution_net": trend["institution_net"],
                "source": "naver_index_trend",
            })
        time.sleep(0.12)

    for i in range(0, len(records), 200):
        supabase.table("market_breadth_daily").upsert(
            records[i:i + 200], on_conflict="trade_date,market,universe_level"
        ).execute()
    print(f"   코스피 시장 수급: 요청 {len(missing)}일, 저장 {len(records)}일, 실패 {failed}일")
    return {"ok": failed <= max(3, len(missing) // 10), "saved": len(records), "failed": failed}
