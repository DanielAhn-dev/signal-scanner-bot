from __future__ import annotations

from datetime import date, timedelta
import os
import sys
from typing import Dict, List, Tuple
import time
import pandas as pd
import numpy as np

from pykrx import stock
from supabase import create_client, Client

# ===== 환경 변수 =====
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("환경 변수 에러: SUPABASE_URL / SERVICE_ROLE_KEY 누락", file=sys.stderr)
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ===== 섹터 매핑 규칙 =====
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
    try:
        res = supabase.table("sectors").select("id,name,metrics").execute()
        rows = res.data or []
    except Exception as e:
        print(f"[sector_map] 조회 실패: {e}")
        return {}

    mapping: Dict[str, str] = {}
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
            mapping[sid] = str(code)
            if inferred:
                new_metrics = dict(metrics)
                new_metrics["krx_index"] = str(code)
                updates.append({"id": sid, "metrics": new_metrics})

    if updates:
        BATCH = 100
        for i in range(0, len(updates), BATCH):
            try:
                supabase.table("sectors").upsert(updates[i : i + BATCH]).execute()
            except Exception:
                pass
    
    return mapping

# ==========================================
# 1. 투자자별(기관/외국인) 수급 저장
# ==========================================
def upsert_investor_daily():
    today = date.today()
    all_rows: List[dict] = []

    print("="*40)
    print("수급 데이터 수집 시작 (기관/외국인)")
    print("="*40)

    for i in range(35):
        d = today - timedelta(days=i)
        if d.weekday() >= 5: continue
        day_str = d.strftime("%Y%m%d")
        print(f"[investor_daily] fetching {day_str}")

        try:
            df_inst = stock.get_market_net_purchases_of_equities_by_ticker(day_str, day_str, "ALL", "기관합계")
            time.sleep(0.1)
            df_foreign = stock.get_market_net_purchases_of_equities_by_ticker(day_str, day_str, "ALL", "외국인")
            time.sleep(0.1)

            if df_inst.empty or df_foreign.empty: continue

            df_merged = pd.merge(
                df_inst.reset_index(),
                df_foreign.reset_index(),
                on='티커',
                suffixes=('_기관', '_외국인')
            )

            for _, row in df_merged.iterrows():
                ticker = row['티커']
                inst_net = float(row.get("순매수거래대금_기관", 0))
                foreign_net = float(row.get("순매수거래대금_외국인", 0))
                
                if foreign_net == 0 and inst_net == 0: continue

                all_rows.append({
                    "date": d.isoformat(),
                    "ticker": ticker,
                    "foreign": foreign_net,
                    "institution": inst_net,
                })
        except Exception:
            continue
    
    if all_rows:
        print(f"[investor_daily] {len(all_rows)}건 저장 중...")
        BATCH = 500
        for i in range(0, len(all_rows), BATCH):
            try:
                supabase.table("investor_daily").upsert(all_rows[i : i + BATCH]).execute()
            except Exception:
                pass
    print("[investor_daily] 완료")

# ==========================================
# 2. 개별 종목 시세 (Stock Daily)
# ==========================================
def upsert_stock_daily():
    try:
        res = supabase.table("stock_daily").select("date").order("date", desc=True).limit(1).execute()
        last = res.data[0]["date"] if res.data else None
        start = date.fromisoformat(last) + timedelta(days=1) if last else date.today() - timedelta(days=365)
    except:
        start = date.today() - timedelta(days=365)

    if start > date.today():
        print("[stock_daily] 최신 상태입니다.")
        return

    start_str = start.strftime("%Y%m%d")
    end_str = date.today().strftime("%Y%m%d")
    print(f"[stock_daily] {start_str}~{end_str} 수집")

    try:
        res = supabase.table("stocks").select("code").execute()
        tickers = [row["code"] for row in res.data or []]
    except:
        return

    all_rows = []
    for i, ticker in enumerate(tickers):
        if (i+1) % 200 == 0: print(f"  -> {i+1}/{len(tickers)} 진행중")
        try:
            df = stock.get_market_ohlcv(start_str, end_str, ticker)
            time.sleep(0.05)
            if df.empty: continue
            
            # 컬럼 처리
            df = df.rename(columns={"시가":"open","고가":"high","저가":"low","종가":"close","거래량":"volume","거래대금":"value"})
            if 'value' not in df.columns: df['value'] = df['close'] * df['volume']

            for ds, row in df.iterrows():
                d = date.fromisoformat(str(ds)[:10])
                all_rows.append({
                    "ticker": ticker, "date": d.isoformat(),
                    "open": float(row["open"]), "high": float(row["high"]),
                    "low": float(row["low"]), "close": float(row["close"]),
                    "volume": float(row["volume"]), "value": float(row["value"]),
                })
        except:
            continue

    if all_rows:
        BATCH = 500
        for i in range(0, len(all_rows), BATCH):
            try:
                supabase.table("stock_daily").upsert(all_rows[i : i + BATCH]).execute()
            except:
                pass
    print("[stock_daily] 완료")

# ==========================================
# 3. 섹터 시세
# ==========================================
def upsert_sector_daily():
    sector_map = get_sector_index_map()
    if not sector_map: return

    start_str = (date.today() - timedelta(days=260)).strftime("%Y%m%d")
    end_str = date.today().strftime("%Y%m%d")
    rows = []

    for sid, code in sector_map.items():
        try:
            df = stock.get_index_ohlcv(start_str, end_str, code)
            time.sleep(0.1)
            for ds, row in df.iterrows():
                rows.append({
                    "sector_id": sid,
                    "date": str(ds)[:10],
                    "close": float(row["종가"]),
                    "value": float(row["거래대금"]),
                })
        except:
            continue

    if rows:
        for i in range(0, len(rows), 200):
            try:
                supabase.table("sector_daily").upsert(rows[i:i+200]).execute()
            except:
                pass
    print("[sector_daily] 완료")

# ==========================================
# 4. 지표 계산 및 Daily Indicators (핵심)
# ==========================================
def calculate_rsi(series: pd.Series, period: int = 14):
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).fillna(0)
    loss = (-delta.where(delta < 0, 0)).fillna(0)
    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def calculate_avwap(df: pd.DataFrame, anchor_idx: int):
    if anchor_idx < 0 or anchor_idx >= len(df): return None
    subset = df.iloc[anchor_idx:].copy()
    pv = (subset['close'] * subset['volume']).cumsum()
    v = subset['volume'].cumsum()
    return (pv / v).iloc[-1]

def upsert_daily_indicators():
    print("\n" + "="*40)
    print("지표 산출 및 daily_indicators 적재")
    print("="*40)

    today = date.today()
    start_str = (today - timedelta(days=400)).strftime("%Y%m%d")
    end_str = today.strftime("%Y%m%d")

    tickers = stock.get_market_ticker_list(market="KOSPI") + stock.get_market_ticker_list(market="KOSDAQ")
    print(f"대상 종목: {len(tickers)}개")
    
    upsert_buffer = []
    
    for idx, code in enumerate(tickers):
        if (idx + 1) % 100 == 0: print(f"  -> {idx + 1}/{len(tickers)}")

        try:
            df = stock.get_market_ohlcv(start_str, end_str, code)
            if df.empty or len(df) < 200: continue
            
            # 컬럼 표준화
            df = df.rename(columns={"시가":"open","고가":"high","저가":"low","종가":"close","거래량":"volume","거래대금":"value","등락률":"change"})
            
            # 안전장치: 컬럼 누락 시 강제 매핑
            if 'close' not in df.columns and df.shape[1] >= 5:
                cols = df.columns.tolist()
                df = df.rename(columns={cols[0]:'open', cols[1]:'high', cols[2]:'low', cols[3]:'close', cols[4]:'volume'})
            
            if 'value' not in df.columns:
                df['value'] = df['close'] * df['volume']

            # 지표 계산
            df['sma20'] = df['close'].rolling(20).mean()
            df['sma50'] = df['close'].rolling(50).mean()
            df['sma200'] = df['close'].rolling(200).mean()
            df['slope200'] = df['sma200'].diff(5)
            df['rsi14'] = calculate_rsi(df['close'])
            df['roc14'] = df['close'].pct_change(14) * 100
            df['roc21'] = df['close'].pct_change(21) * 100

            # AVWAP
            avwap_52w = None
            try:
                # 52주 저점
                window = min(250, len(df))
                low_idx = df['low'].tail(window).idxmin()
                avwap_52w = calculate_avwap(df, df.index.get_loc(low_idx))
            except: pass

            avwap_swing = None
            try:
                # 단기 20일 저점
                swing_idx = df['low'].tail(20).idxmin()
                avwap_swing = calculate_avwap(df, df.index.get_loc(swing_idx))
            except: pass

            last = df.iloc[-1]
            def n(v): return None if pd.isna(v) else float(v)

            data = {
                "code": code,
                "trade_date": df.index[-1].strftime("%Y-%m-%d"),
                "close": n(last['close']),
                "volume": int(last['volume']),
                "value_traded": n(last['value']),
                "sma20": n(last.get('sma20')),
                "sma50": n(last.get('sma50')),
                "sma200": n(last.get('sma200')),
                "slope200": n(last.get('slope200')),
                "rsi14": n(last.get('rsi14')),
                "roc14": n(last.get('roc14')),
                "roc21": n(last.get('roc21')),
                "avwap_52w_low": n(avwap_52w),
                "avwap_swing_low": n(avwap_swing),
                "avwap_breakout": n(avwap_swing)
            }
            
            upsert_buffer.append(data)

            # 100개씩 저장 시도
            if len(upsert_buffer) >= 100:
                try:
                    supabase.table("daily_indicators").upsert(upsert_buffer).execute()
                except Exception:
                    # 실패 시 개별 저장 시도 (FK 에러 무시)
                    for item in upsert_buffer:
                        try: supabase.table("daily_indicators").upsert(item).execute()
                        except: pass
                upsert_buffer = []
                time.sleep(0.05)

        except Exception:
            continue

    # 남은 버퍼 처리
    if upsert_buffer:
        try:
            supabase.table("daily_indicators").upsert(upsert_buffer).execute()
        except Exception:
            for item in upsert_buffer:
                try: supabase.table("daily_indicators").upsert(item).execute()
                except: pass

    print("[daily_indicators] 완료")

if __name__ == "__main__":
    # 순서대로 실행
    upsert_sector_daily()
    upsert_investor_daily()
    upsert_stock_daily()
    upsert_daily_indicators()
