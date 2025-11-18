# scripts/fetch_sectors.py
from __future__ import annotations

from datetime import date, timedelta
import os
from typing import Dict, List, Tuple
import time

from pykrx import stock
from supabase import create_client, Client

# ===== 환경 변수 =====
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ===== 섹터 이름 키워드 → KRX 업종 지수 코드 매핑 규칙 =====
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
    Supabase.sectors 에서 id/name/metrics.krx_index 를 읽어
    sector_id -> KRX 지수 코드 맵을 만든다.

    metrics.krx_index 가 비어 있는 섹터는 이름으로 코드 추론 후
    sectors.metrics.krx_index 를 채워 넣어 다음 실행부터는 DB만 참조하도록 한다.
    """
    try:
        res = supabase.table("sectors").select("id,name,metrics").execute()
        rows = res.data or []
    except Exception as e:
        print(f"[sector_map] sectors 조회 실패: {e}")
        return {}

    mapping: Dict[str, str] = {}
    missing_names: List[str] = []
    updates: List[dict] = []

    for row in rows:
        sid = row["id"]
        name = row.get("name") or ""
        metrics = row.get("metrics") or {}

        code = metrics.get("krx_index")
        inferred = False
        if not code:
            code = infer_index_code_from_name(name)
            inferred = code is not None

        if code:
            code_str = str(code)
            mapping[sid] = code_str

            # 새로 추론한 경우에는 sectors.metrics.krx_index 를 업데이트 큐에 넣는다.
            if inferred:
                new_metrics = dict(metrics)
                new_metrics["krx_index"] = code_str
                updates.append({"id": sid, "metrics": new_metrics})
        else:
            missing_names.append(name)

    print(f"[sector_map] 사용 가능한 섹터 수 = {len(mapping)}")
    if missing_names:
        print(
            f"[sector_map] 코드 매핑 실패 섹터 예시(상위 5개): {missing_names[:5]}"
        )

    # 필요 시 sectors.metrics.krx_index 보정
    if updates:
        print(
            f"[sector_map] 이름 기반으로 krx_index 를 보정할 섹터 수 = {len(updates)}"
        )
        BATCH = 100
        for i in range(0, len(updates), BATCH):
            chunk = updates[i : i + BATCH]
            try:
                supabase.table("sectors").upsert(chunk).execute()
            except Exception as e:
                print(f"[sector_map] sectors.krx_index upsert 실패: {e}")

    return mapping

# ✅✅✅ --- 수정된 upsert_investor_daily 함수 --- ✅✅✅
def upsert_investor_daily():
    """
    최신 날짜부터 과거 30일까지 하루씩 순회하며,
    '기관'과 '외국인'의 '개별 종목' 순매수 데이터를 investor_daily 테이블에 저장.
    """
    # ✅✅✅ 누락되었던 pandas import 추가 ✅✅✅
    import pandas as pd

    today = date.today()
    all_rows: List[dict] = []

    print("="*40)
    print("수급 데이터 수집 시작 (기관/외국인)")
    print("="*40)

    for i in range(35): # 약 25 영업일
        d = today - timedelta(days=i)
        if d.weekday() >= 5: continue
            
        day_str = d.strftime("%Y%m%d")
        print(f"[investor_daily] fetching data for {day_str}")

        try:
            # 1. 기관 데이터 조회
            df_inst = stock.get_market_net_purchases_of_equities_by_ticker(day_str, day_str, "ALL", "기관합계")
            time.sleep(0.2) # 서버 부하 방지
            
            # 2. 외국인 데이터 조회
            df_foreign = stock.get_market_net_purchases_of_equities_by_ticker(day_str, day_str, "ALL", "외국인")
            time.sleep(0.2)

            if df_inst.empty or df_foreign.empty:
                print(f"  -> {day_str} 기관 또는 외국인 데이터 없음")
                continue

            # 두 데이터프레임을 '티커' 기준으로 합치기
            df_merged = pd.merge(
                df_inst.reset_index(),
                df_foreign.reset_index(),
                on='티커',
                suffixes=('_기관', '_외국인')
            )
            
            print(f"  -> {day_str} 데이터 {len(df_merged)}건 조회 및 병합 성공")

            for _, row in df_merged.iterrows():
                ticker = row['티커']
                inst_net = float(row.get("순매수거래대금_기관", 0))
                foreign_net = float(row.get("순매수거래대금_외국인", 0))

                if foreign_net == 0 and inst_net == 0:
                    continue

                all_rows.append({
                    "date": d.isoformat(),
                    "ticker": ticker,
                    "foreign": foreign_net,
                    "institution": inst_net,
                })
        except Exception as e:
            print(f"[ERROR] {day_str} 데이터 조회 중 에러 발생: {e}")
            continue
    
    if not all_rows:
        print("[investor_daily] 최종적으로 적재할 데이터가 없습니다.")
        return

    print(f"\n[investor_daily] 총 {len(all_rows)}개의 투자자별 거래 데이터를 upsert 합니다...")
    BATCH = 200
    for i in range(0, len(all_rows), BATCH):
        chunk = all_rows[i : i + BATCH]
        supabase.table("investor_daily").upsert(chunk).execute()
    
    print(f"[investor_daily] upsert 완료. 총 rows={len(all_rows)}")
# ✅✅✅ --- 함수 수정 끝 --- ✅✅✅

def upsert_stock_daily():
    try:
        res = supabase.table("stock_daily").select("date").order("date", desc=True).limit(1).execute()
        last_date_str = (res.data[0]["date"] if res.data else None)
        if last_date_str:
            start = date.fromisoformat(last_date_str) + timedelta(days=1)
        else:
            start = date.today() - timedelta(days=365)
    except Exception as e:
        print(f"[stock_daily] 마지막 날짜 조회 실패, 1년 전부터 시작: {e}")
        start = date.today() - timedelta(days=365)

    today = date.today()
    if start > today:
        print("[stock_daily] 이미 모든 데이터가 최신입니다.")
        return

    start_str = start.strftime("%Y%m%d")
    end_str = today.strftime("%Y%m%d")
    print(f"[stock_daily] {start_str}~{end_str} 기간의 데이터를 수집합니다.")

    try:
        res = supabase.table("stocks").select("code").execute()
        tickers = [row["code"] for row in res.data or []]
    except Exception as e:
        print(f"[stock_daily] stocks 목록 조회 실패: {e}")
        return

    all_rows: List[dict] = []
    for i, ticker in enumerate(tickers):
        if (i + 1) % 100 == 0:
            print(f"[stock_daily] fetching {i+1}/{len(tickers)}: {ticker}")
        try:
            df = stock.get_market_ohlcv(start_str, end_str, ticker)
            time.sleep(0.1)
            if df.empty: continue

            for ds, row in df.iterrows():
                d = date.fromisoformat(str(ds)[:10])
                all_rows.append({
                    "ticker": ticker, "date": d.isoformat(),
                    "open": float(row["시가"]), "high": float(row["고가"]),
                    "low": float(row["저가"]), "close": float(row["종가"]),
                    "volume": float(row["거래량"]), "value": float(row.get("거래대금", 0)),
                })
        except Exception as e:
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
            time.sleep(0.1)  # KRX 서버 부하 방지를 위한 약간의 딜레이
        except Exception as e:
            print(
                f"[sector_daily] get_index_ohlcv error sector={sector_id} code={index_code}: {e}"
            )
            continue

        for ds, row in df.iterrows():
            d = date.fromisoformat(str(ds)[:10])
            rows.append(
                {
                    "sector_id": sector_id,
                    "date": d.isoformat(),
                    "close": float(row["종가"]),
                    "value": float(row["거래대금"]),
                }
            )

    if not rows:
        print("[sector_daily] 적재할 row 가 없습니다.")
        return

    BATCH = 200
    print(f"[sector_daily] 총 {len(rows)}개의 섹터 시세 데이터를 upsert 합니다...")
    for i in range(0, len(rows), BATCH):
        chunk = rows[i : i + BATCH]
        supabase.table("sector_daily").upsert(chunk).execute()
    print(f"[sector_daily] upsert 완료. 총 rows={len(rows)}")

if __name__ == "__main__":
    upsert_sector_daily()
    upsert_investor_daily()
    upsert_stock_daily()

