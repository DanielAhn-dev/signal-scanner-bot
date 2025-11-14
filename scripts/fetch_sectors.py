# scripts/fetch_sectors.py
from __future__ import annotations

from datetime import date, timedelta
import os
from typing import Dict, List, Tuple

from pykrx import stock
from supabase import create_client, Client

# ===== 환경 변수 =====
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ===== 섹터 이름 키워드 → KRX 업종 지수 코드 매핑 규칙 =====
# 우선순위가 높은 규칙을 위에 적는다.
NAME_TO_INDEX_RULES: List[Tuple[str, str]] = [
    ("반도체", "1014"),
    ("전자장비", "1013"),
    ("전기전자", "1013"),
    ("화학", "1010"),
    ("철강", "1011"),
    ("기계", "1012"),
    ("조선", "1017"),
    ("운수장비", "1017"),
    ("은행", "1027"),
    ("보험", "1027"),
    ("금융", "1027"),
]


def infer_index_code_from_name(name: str) -> str | None:
    for kw, code in NAME_TO_INDEX_RULES:
        if kw in name:
            return code
    return None


def get_sector_index_map() -> Dict[str, str]:
    """
    1. sectors.metrics.krx_index 에서 명시적 매핑 사용
    2. name 키워드(NAME_TO_INDEX_RULES)로 추론
    """
    try:
        res = supabase.table("sectors").select("id,name,metrics").execute()
        rows = res.data or []
    except Exception as e:
        print(f"[sector_map] sectors 조회 실패: {e}")
        return {}

    mapping: Dict[str, str] = {}
    missing_names: List[str] = []

    for row in rows:
        sid = row["id"]
        name = row.get("name") or ""
        metrics = row.get("metrics") or {}

        code = metrics.get("krx_index")
        if not code:
            code = infer_index_code_from_name(name)

        if code:
            mapping[sid] = str(code)
        else:
            missing_names.append(name)

    print(f"[sector_map] 사용 가능한 섹터 수={len(mapping)}")
    if missing_names:
        print(f"[sector_map] 코드 매핑 실패 섹터 예시(상위 5개): {missing_names[:5]}")
    return mapping


def bizdays(start: date, end: date) -> List[date]:
    d = start
    out: List[date] = []
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def upsert_sector_daily():
    today = date.today()
    start = today - timedelta(days=260)
    start_str = start.strftime("%Y%m%d")
    end_str = today.strftime("%Y%m%d")

    sector_index_map = get_sector_index_map()
    if not sector_index_map:
        print("[sector_daily] 매핑된 섹터가 없습니다. 작업을 건너뜁니다.")
        return

    rows: List[dict] = []
    for sector_id, index_code in sector_index_map.items():
        try:
            df = stock.get_index_ohlcv(start_str, end_str, index_code)
        except Exception as e:
            print(f"[sector_daily] get_index_ohlcv error sector={sector_id} code={index_code}: {e}")
            continue

        for ds, row in df.iterrows():
            d = date.fromisoformat(str(ds)[:10])
            rows.append(
                {"sector_id": sector_id, "date": d.isoformat(), "close": float(row["종가"]), "value": float(row["거래대금"])}
            )

    if not rows:
        print("[sector_daily] 적재할 row 가 없습니다.")
        return

    BATCH = 200
    for i in range(0, len(rows), BATCH):
        chunk = rows[i : i + BATCH]
        supabase.table("sector_daily").upsert(chunk).execute()
    print(f"[sector_daily] upsert rows={len(rows)}")


def upsert_investor_daily():
    today = date.today()
    start = today - timedelta(days=30)
    all_rows: List[dict] = []

    from_str = start.strftime("%Y%m%d")
    to_str = today.strftime("%Y%m%d")

    for market in ["KOSPI", "KOSDAQ"]:
        try:
            df = stock.get_market_net_purchases_of_equities_by_ticker(
                fromdate=from_str, todate=to_str, market=market
            )
        except Exception as e:
            print(f"[investor] error {from_str}~{to_str} {market}: {e}")
            continue

        for code, row in df.iterrows():
            # 이 함수는 구간 조회를 하므로, date 컬럼이 따로 없음
            # 가장 마지막 날짜로 저장하거나, 더 정확히 하려면 하루 단위로 호출 필요
            # 우선은 구간 마지막 날짜로 저장
            foreign = float(row.get("외국인", 0))
            inst = float(row.get("기관합계", row.get("기관", 0)))
            date_iso = today.isoformat() # 오늘 날짜 기준.

            all_rows.append({"date": date_iso, "ticker": code, "foreign": foreign, "institution": inst})

    if not all_rows:
        print("[investor_daily] 적재할 row 가 없습니다.")
        return

    BATCH = 200
    for i in range(0, len(all_rows), BATCH):
        chunk = all_rows[i : i + BATCH]
        supabase.table("investor_daily").upsert(chunk).execute()
    print(f"[investor_daily] upsert rows={len(all_rows)}")

def upsert_stock_daily():
    """
    stocks 테이블에 있는 모든 종목의 일봉/거래대금을
    stock_daily 테이블에 upsert.
    """
    try:
        res = supabase.table("stocks").select("code").execute()
        tickers = [row["code"] for row in res.data or []]
    except Exception as e:
        print(f"[stock_daily] stocks 목록 조회 실패: {e}")
        return

    today = date.today()
    start = today - timedelta(days=260) # 약 1년치
    start_str = start.strftime("%Y%m%d")
    end_str = today.strftime("%Y%m%d")
    
    all_rows: List[dict] = []

    for i, ticker in enumerate(tickers):
        # 너무 많은 로그를 막기 위해 100개 단위로만 출력
        if (i + 1) % 100 == 0:
            print(f"[stock_daily] fetching {i+1}/{len(tickers)}: {ticker}")
        try:
            df = stock.get_market_ohlcv(start_str, end_str, ticker)
            if df.empty:
                continue

            for ds, row in df.iterrows():
                d = date.fromisoformat(str(ds)[:10])
                all_rows.append({
                    "ticker": ticker,
                    "date": d.isoformat(),
                    "open": float(row["시가"]),
                    "high": float(row["고가"]),
                    "low": float(row["저가"]),
                    "close": float(row["종가"]),
                    "volume": float(row["거래량"]),
                    "value": float(row.get("거래대금", 0)), # ✅ 수정된 부분
                })
        except Exception as e:
            # 모든 종목 에러를 다 찍으면 너무 많으므로, 특정 에러만 출력
            if "'거래대금'" not in str(e):
                print(f"[stock_daily] get_market_ohlcv error ticker={ticker}: {e}")
            continue

    if not all_rows:
        print("[stock_daily] 적재할 row가 없습니다.")
        return

    print(f"[stock_daily] 총 {len(all_rows)}개의 시세 데이터를 upsert 합니다...")
    BATCH = 100
    for i in range(0, len(all_rows), BATCH):
        chunk = all_rows[i : i + BATCH]
        supabase.table("stock_daily").upsert(chunk).execute()
        print(f"[stock_daily] ... {i+len(chunk)}/{len(all_rows)} 완료")
        
    print(f"[stock_daily] upsert 완료. 총 rows={len(all_rows)}")

if __name__ == "__main__":
    upsert_sector_daily()
    upsert_investor_daily()
    upsert_stock_daily()