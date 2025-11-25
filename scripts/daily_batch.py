from __future__ import annotations

import os
import sys
import time
import traceback
from datetime import date, datetime, timedelta
from typing import List, Dict, Tuple

import pandas as pd
import numpy as np
from pykrx import stock
from supabase import create_client, Client

# ===== 환경 변수 설정 =====
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("🚨 [Error] SUPABASE_URL or SERVICE_ROLE_KEY missing", file=sys.stderr)
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ===== 섹터 매핑 규칙 (기존 fetch_sectors.py 내용 통합) =====
NAME_TO_INDEX_RULES: List[Tuple[str, str]] = [
    ("반도체", "1014"), ("전자장비", "1013"), ("전기전자", "1013"),
    ("화학", "1010"), ("철강", "1011"), ("기계", "1012"),
    ("조선", "1017"), ("운수장비", "1017"), ("은행", "1027"),
    ("보험", "1027"), ("금융", "1027"),
]

def infer_index_code_from_name(name: str) -> str | None:
    for kw, code in NAME_TO_INDEX_RULES:
        if kw in name: return code
    return None

# ===== 지표 계산 헬퍼 함수 =====
def calculate_rsi(series: pd.Series, period: int = 14):
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).fillna(0)
    loss = (-delta.where(delta < 0, 0)).fillna(0)
    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def calculate_avwap(df: pd.DataFrame, anchor_idx: int):
    if len(df) == 0 or anchor_idx < 0 or anchor_idx >= len(df): return None
    subset = df.iloc[anchor_idx:].copy()
    v_cumsum = subset['volume'].cumsum()
    if v_cumsum.iloc[-1] == 0: return None
    pv = (subset['close'] * subset['volume']).cumsum()
    return (pv / v_cumsum).iloc[-1]

# ===== 1. 섹터 정보 업데이트 (기존 로직) =====
def update_sectors_meta():
    print("\n[1/5] 섹터 메타데이터 업데이트...")
    try:
        res = supabase.table("sectors").select("id,name,metrics").execute()
        rows = res.data or []
        
        updates = []
        for row in rows:
            sid = row["id"]
            name = row.get("name") or ""
            metrics = row.get("metrics") or {}
            
            # 이미 코드가 있으면 스킵, 없으면 추론
            if not metrics.get("krx_index"):
                code = infer_index_code_from_name(name)
                if code:
                    new_metrics = dict(metrics)
                    new_metrics["krx_index"] = str(code)
                    updates.append({"id": sid, "metrics": new_metrics})
        
        if updates:
            print(f"  -> {len(updates)}개 섹터 매핑 업데이트")
            for i in range(0, len(updates), 100):
                supabase.table("sectors").upsert(updates[i:i+100]).execute()
    except Exception as e:
        print(f"  -> 섹터 업데이트 실패 (무시 가능): {e}")

# ===== 2. 당일 시세 일괄 수집 (최적화됨) =====
def fetch_and_save_today_market():
    today_str = date.today().strftime("%Y%m%d")
    print(f"\n[2/5] {today_str} 전 종목 시세 수집...")

    try:
        # 휴장일 체크 (삼성전자 기준)
        check = stock.get_market_ohlcv(today_str, today_str, "005930")
        if check.empty:
            print("🔴 오늘은 휴장일이거나 장 마감 전입니다.")
            return False

        # KOSPI/KOSDAQ 한 번에 수집
        df_kospi = stock.get_market_ohlcv_by_ticker(today_str, market="KOSPI")
        df_kosdaq = stock.get_market_ohlcv_by_ticker(today_str, market="KOSDAQ")
        df_total = pd.concat([df_kospi, df_kosdaq])

        upsert_rows = []
        for ticker, row in df_total.iterrows():
            if row['거래량'] == 0: continue
            upsert_rows.append({
                "ticker": ticker,
                "date": date.today().isoformat(),
                "open": int(row["시가"]),
                "high": int(row["고가"]),
                "low": int(row["저가"]),
                "close": int(row["종가"]),
                "volume": int(row["거래량"]),
                "value": float(row["거래대금"]),
            })

        if upsert_rows:
            print(f"  -> {len(upsert_rows)}개 종목 저장 중...")
            # 1000개씩 배치 저장 (속도 향상)
            for i in range(0, len(upsert_rows), 1000):
                try:
                    supabase.table("stock_daily").upsert(upsert_rows[i:i+1000]).execute()
                except:
                    # 에러 시 더 작게 쪼개서 재시도
                    chunk = upsert_rows[i:i+1000]
                    for j in range(0, len(chunk), 100):
                        try: supabase.table("stock_daily").upsert(chunk[j:j+100]).execute()
                        except: pass
        return True
    except Exception as e:
        print(f"🚨 시세 수집 에러: {e}")
        traceback.print_exc()
        return False

# ===== 3. 투자자 수급 & 섹터 지수 수집 =====
def fetch_other_market_data():
    today_str = date.today().strftime("%Y%m%d")
    today_iso = date.today().isoformat()
    print(f"\n[3/5] 투자자 수급 및 섹터 지수 수집...")

    # 3-1. 투자자 수급
    try:
        df_inst = stock.get_market_net_purchases_of_equities_by_ticker(today_str, "ALL", "기관합계")
        time.sleep(0.5)
        df_foreign = stock.get_market_net_purchases_of_equities_by_ticker(today_str, "ALL", "외국인")
        
        df_merged = pd.merge(df_inst, df_foreign, left_index=True, right_index=True, suffixes=('_기관', '_외국인'))
        
        inv_rows = []
        for ticker, row in df_merged.iterrows():
            i_net, f_net = int(row['순매수거래대금_기관']), int(row['순매수거래대금_외국인'])
            if i_net == 0 and f_net == 0: continue
            inv_rows.append({
                "date": today_iso, "ticker": ticker,
                "institution": i_net, "foreign": f_net
            })
        
        if inv_rows:
            for i in range(0, len(inv_rows), 1000):
                supabase.table("investor_daily").upsert(inv_rows[i:i+1000]).execute()
            print("  -> 투자자 수급 저장 완료")
    except Exception as e:
        print(f"  -> 투자자 수급 실패: {e}")

    # 3-2. 섹터 지수 (sector_daily)
    try:
        # 매핑된 섹터 인덱스 가져오기
        res = supabase.table("sectors").select("id, metrics").execute()
        sector_rows = []
        
        for row in (res.data or []):
            sid = row['id']
            code = row.get('metrics', {}).get('krx_index')
            if not code: continue
            
            # 해당 인덱스의 오늘 시세
            try:
                df = stock.get_index_ohlcv(today_str, today_str, code)
                if df.empty: continue
                val = df.iloc[0]
                sector_rows.append({
                    "sector_id": sid, "date": today_iso,
                    "close": float(val["종가"]), "value": float(val["거래대금"])
                })
            except: pass
            time.sleep(0.1) # API 제한 고려
            
        if sector_rows:
            supabase.table("sector_daily").upsert(sector_rows).execute()
            print("  -> 섹터 지수 저장 완료")
    except Exception as e:
        print(f"  -> 섹터 지수 실패: {e}")

# ===== 4. 지표 계산 (핵심) =====
def calculate_indicators():
    print("\n[4/5] 기술적 지표 계산...")
    today_iso = date.today().isoformat()
    
    # 오늘 데이터가 있는 종목만 대상
    try:
        res = supabase.table("stock_daily").select("ticker").eq("date", today_iso).execute()
        target_tickers = [r['ticker'] for r in res.data]
    except: return

    print(f"  -> 대상 종목: {len(target_tickers)}개")
    
    # 50개씩 끊어서 처리
    chunk_size = 50
    for i in range(0, len(target_tickers), chunk_size):
        batch = target_tickers[i : i + chunk_size]
        if i % 200 == 0: print(f"  -> 진행: {i}/{len(target_tickers)}")
        
        upsert_buffer = []
        try:
            # 1년치 데이터 조회
            h_res = supabase.table("stock_daily").select("*").in_("ticker", batch)\
                .gte("date", (date.today() - timedelta(days=365)).isoformat())\
                .order("date", desc=False).execute()
            
            h_df = pd.DataFrame(h_res.data)
            if h_df.empty: continue
            h_df['date'] = pd.to_datetime(h_df['date'])
            
            for ticker in batch:
                df = h_df[h_df['ticker'] == ticker].sort_values('date')
                if len(df) < 20: continue

                # 지표 계산
                close = df['close']
                df['rsi14'] = calculate_rsi(close, 14)
                
                # [수정] roc14 계산 로직 추가 (이 부분이 빠져서 에러 발생)
                df['roc14'] = close.pct_change(14) * 100
                df['roc21'] = close.pct_change(21) * 100
                
                # 이평선
                df['sma20'] = close.rolling(20).mean()
                df['sma50'] = close.rolling(50).mean()
                df['sma200'] = close.rolling(200).mean()
                df['slope200'] = df['sma200'].diff(5)

                # 52주 최저점 AVWAP
                avwap_val = None
                try:
                    window = min(250, len(df))
                    low_idx_date = df['low'].tail(window).idxmin()
                    idx_loc = df.index.get_loc(low_idx_date)
                    avwap_val = calculate_avwap(df, idx_loc)
                except: pass
                
                last = df.iloc[-1]
                
                def n(v): return None if pd.isna(v) or np.isinf(v) else float(v)
                def n_int(v): return None if pd.isna(v) or np.isinf(v) else int(v)
                
                upsert_buffer.append({
                    "code": ticker,
                    "trade_date": last['date'].strftime("%Y-%m-%d"),
                    "close": n(last['close']),
                    "volume": n_int(last['volume']),
                    "value_traded": n(last['value']),
                    "sma20": n(last['sma20']),
                    "sma50": n(last['sma50']),
                    "sma200": n(last['sma200']),
                    "slope200": n(last['slope200']),
                    "rsi14": n(last['rsi14']),
                    "roc14": n(last['roc14']), # 이제 값이 있으므로 에러 안 남
                    "roc21": n(last['roc21']),
                    "avwap_breakout": n(avwap_val),
                    "updated_at": datetime.now().isoformat() 
                })
            
            if upsert_buffer:
                supabase.table("daily_indicators").upsert(upsert_buffer).execute()
                
        except Exception as e:
            print(f"  -> 배치 에러: {e}")
            # 에러 원인 파악을 위해 더 자세히 출력 (필요시)
            # traceback.print_exc()
            continue

# ===== 5. 데이터 정리 =====
def cleanup_old_data():
    print("\n[5/5] 오래된 데이터 정리...")
    cutoff = (date.today() - timedelta(days=366)).isoformat()
    try:
        supabase.table("stock_daily").delete().lt("date", cutoff).execute()
        supabase.table("investor_daily").delete().lt("date", cutoff).execute()
    except: pass

if __name__ == "__main__":
    print(f"🚀 Daily Batch Start: {datetime.now()}")
    
    # 1. 섹터 메타데이터 (가끔 바뀌므로 매일 해도 무방)
    update_sectors_meta()
    
    # 2. 오늘 시세 수집 (가장 중요)
    if fetch_and_save_today_market():
        # 3. 기타 데이터
        fetch_other_market_data()
        # 4. 지표 계산
        calculate_indicators()
        # 5. 청소
        cleanup_old_data()
        
    print("🏁 Daily Batch End")
