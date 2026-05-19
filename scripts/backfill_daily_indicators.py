"""
scripts/backfill_daily_indicators.py
====================================
과거 데이터 기반 daily_indicators 역계산 및 적재
- 대상: 2025-04-11 ~ 2026-02-08 (stock_daily가 있는 모든 기간)
- 영향: daily_indicators 테이블에만 추가/갱신, 배치 영향 없음
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
import numpy as np
from supabase import create_client, Client

# ===== 환경 변수 설정 =====
def load_env_file(filepath=".env"):
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
    print("🚨 [Error] SUPABASE_URL or SERVICE_ROLE_KEY missing", file=sys.stderr)
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ===== 유틸리티 =====
def safe_float(x, default=0.0):
    try:
        v = float(x)
        return default if (np.isnan(v) or np.isinf(v)) else v
    except:
        return default


def safe_int(x, default=0):
    try:
        v = float(x)
        if np.isnan(v) or np.isinf(v):
            return default
        return int(v)
    except:
        return default


def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """RSI 14 계산"""
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0).fillna(0)
    loss = (-delta.where(delta < 0, 0.0)).fillna(0)
    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def calculate_avwap(df: pd.DataFrame, anchor_idx: int) -> Optional[float]:
    """최저가 이후 VWAP 계산"""
    if len(df) == 0 or anchor_idx < 0 or anchor_idx >= len(df):
        return None
    subset = df.iloc[anchor_idx:].copy()
    v_cumsum = subset["volume"].cumsum()
    if v_cumsum.iloc[-1] == 0:
        return None
    pv = (subset["close"] * subset["volume"]).cumsum()
    return float((pv / v_cumsum).iloc[-1])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="daily_indicators historical backfill")
    parser.add_argument("--start", default="", help="start date (YYYYMMDD or YYYY-MM-DD)")
    parser.add_argument("--end", default="", help="end date (YYYYMMDD or YYYY-MM-DD)")
    return parser.parse_args()


def normalize_date(value: str) -> str:
    s = value.strip().replace("-", "")
    if len(s) != 8 or not s.isdigit():
        raise ValueError(f"invalid date: {value}")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def normalize_numeric(v):
    """부동소수점 정규화"""
    try:
        fv = float(v)
        return None if (pd.isna(fv) or np.isinf(fv)) else round(fv, 4)
    except:
        return None


def normalize_int(v):
    """정수 정규화"""
    try:
        fv = float(v)
        return None if (pd.isna(fv) or np.isinf(fv)) else int(fv)
    except:
        return None


# =============================================
# STEP 1: stock_daily 데이터 로드
# =============================================
def fetch_all_stock_daily() -> pd.DataFrame:
    """stock_daily의 전체 데이터 조회 (2025-04-11 ~ 현재)"""
    print("\n[1/3] stock_daily 데이터 로드...")
    
    try:
        # 전체 데이터 조회 (pagination)
        all_rows = []
        offset = 0
        page_size = 1000
        
        while True:
            res = supabase.table("stock_daily") \
                .select("*") \
                .range(offset, offset + page_size - 1) \
                .order("date", desc=False) \
                .execute()
            
            if not res.data:
                break
            
            all_rows.extend(res.data)
            offset += page_size
            
            if len(res.data) < page_size:
                break
            
            if offset % (page_size * 10) == 0:
                print(f"  -> 로드 중: {offset}행...")
        
        if not all_rows:
            print("  ⚠️ stock_daily 데이터가 없습니다.")
            return pd.DataFrame()
        
        df = pd.DataFrame(all_rows)
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values(["ticker", "date"])
        
        print(f"  ✅ {len(df):,}행 로드 완료")
        print(f"     범위: {df['date'].min().date()} ~ {df['date'].max().date()}")
        print(f"     종목: {df['ticker'].nunique()}개")
        
        return df
    except Exception as e:
        print(f"  ❌ 로드 실패: {e}")
        return pd.DataFrame()


# =============================================
# STEP 2: 지표 계산 및 버퍼링
# =============================================
def process_ticker_indicators(ticker: str, df_ticker: pd.DataFrame) -> list:
    """단일 종목의 모든 날짜에 대한 지표 계산"""
    rows = []
    
    try:
        df = df_ticker.copy()
        # stock_daily에 동일 ticker/date 중복이 있을 수 있어 마지막 행만 유지
        df = df.drop_duplicates(subset=["date"], keep="last")
        df = df.sort_values("date")
        
        if len(df) < 20:  # 최소 20행 필요
            return []
        
        close = df["close"].astype(float)
        
        # 지표 계산
        df["rsi14"] = calculate_rsi(close, 14)
        df["roc14"] = close.pct_change(14) * 100
        df["roc21"] = close.pct_change(21) * 100
        df["sma20"] = close.rolling(20).mean()
        df["sma50"] = close.rolling(50).mean()
        df["sma200"] = close.rolling(200).mean()
        df["slope200"] = df["sma200"].diff(5)
        
        # 모든 행에 대해 daily_indicators 생성
        for idx, row in df.iterrows():
            date_str = row["date"].strftime("%Y-%m-%d")
            
            # AVWAP: 최저가 이후
            avwap_val = None
            try:
                window = min(250, len(df[:df.index.get_loc(idx) + 1]))
                df_subset = df[:df.index.get_loc(idx) + 1].tail(window)
                low_idx = df_subset["low"].astype(float).idxmin()
                idx_loc = df_subset.index.get_loc(low_idx)
                avwap_val = calculate_avwap(
                    df_subset.assign(
                        close=df_subset["close"].astype(float),
                        volume=df_subset["volume"].astype(float)
                    ),
                    idx_loc
                )
            except:
                pass
            
            rows.append({
                "code": ticker,
                "trade_date": date_str,
                "close": normalize_numeric(row["close"]),
                "volume": normalize_int(row.get("volume")),
                "value_traded": normalize_numeric(row.get("value")),
                "sma20": normalize_numeric(row.get("sma20")),
                "sma50": normalize_numeric(row.get("sma50")),
                "sma200": normalize_numeric(row.get("sma200")),
                "slope200": normalize_numeric(row.get("slope200")),
                "rsi14": normalize_numeric(row.get("rsi14")),
                "roc14": normalize_numeric(row.get("roc14")),
                "roc21": normalize_numeric(row.get("roc21")),
                "avwap_breakout": avwap_val,
                "updated_at": datetime.now().isoformat(),
            })
    except Exception as e:
        print(f"  ⚠️ {ticker} 계산 실패: {e}")
    
    return rows


def dedupe_indicator_rows(rows: list) -> list:
    """(code, trade_date) 기준으로 중복 제거하여 upsert 충돌 방지"""
    deduped = {}
    for row in rows:
        key = (row.get("code"), row.get("trade_date"))
        deduped[key] = row
    return list(deduped.values())


# =============================================
# STEP 3: DB에 적재
# =============================================
def upsert_daily_indicators(all_rows: list, batch_size: int = 100, start_date: str = "", end_date: str = ""):
    """2026-02-09 이전 데이터만 insert (기존 데이터와 충돌 방지)"""
    print(f"\n[3/3] daily_indicators 적재 ({len(all_rows):,}행)...")
    
    cutoff_date = datetime.strptime("2026-02-09", "%Y-%m-%d").date()

    start_dt = datetime.strptime(start_date, "%Y-%m-%d").date() if start_date else None
    end_dt = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else None

    # 2026-02-09 이전 데이터 + 선택된 범위만 필터링
    filtered_rows = []
    for r in all_rows:
        row_dt = datetime.strptime(r["trade_date"], "%Y-%m-%d").date()
        if row_dt >= cutoff_date:
            continue
        if start_dt and row_dt < start_dt:
            continue
        if end_dt and row_dt > end_dt:
            continue
        filtered_rows.append(r)

    filtered_rows = dedupe_indicator_rows(filtered_rows)
    
    print(f"  -> 필터링 결과: {len(filtered_rows):,}행")
    if start_date or end_date:
        print(f"  -> 범위 필터: {start_date or 'MIN'} ~ {end_date or 'MAX'}")
    else:
        print(f"  -> 기준: 2026-02-09 이전 데이터만 대상")
    
    if not filtered_rows:
        print(f"  ⚠️ 2026-02-09 이전 데이터 없음 (역계산 대상 없음)")
        return
    
    total = len(filtered_rows)
    success = 0
    
    for i in range(0, total, batch_size):
        batch = filtered_rows[i:i+batch_size]
        batch_num = i // batch_size + 1
        total_batches = (total + batch_size - 1) // batch_size
        
        try:
            # 작은 배치로 나눠서 충돌 최소화
            supabase.table("daily_indicators").upsert(batch, on_conflict="code,trade_date").execute()
            success += len(batch)
            
            if batch_num % 50 == 0 or batch_num == total_batches:
                print(f"  -> 진행: [{batch_num}/{total_batches}] {success:,}행 적재됨")
        except Exception as e:
            print(f"  ⚠️ 배치 #{batch_num} upsert 실패 ({len(batch)}행): {str(e)[:80]}")
            # 배치 크기 더 줄여서 재시도
            for j, row in enumerate(batch):
                try:
                    supabase.table("daily_indicators").upsert([row], on_conflict="code,trade_date").execute()
                    success += 1
                except Exception as row_err:
                    if j == 0:  # 첫 행만 로깅
                        print(f"    ↳ 개별 insert도 실패: {str(row_err)[:60]}")
    
    print(f"  ✅ {success:,}행 적재 완료")


# =============================================
# 메인 실행
# =============================================
def main():
    args = parse_args()
    print("="*60)
    print("daily_indicators 역계산 및 적재")
    print("="*60)
    
    # STEP 1: stock_daily 로드
    df_all = fetch_all_stock_daily()
    if df_all.empty:
        print("❌ 종료 (데이터 없음)")
        return
    
    # STEP 2: 지표 계산
    print(f"\n[2/3] 지표 계산 ({df_all['ticker'].nunique()}개 종목)...")
    all_rows = []
    
    tickers = df_all["ticker"].unique()
    for idx, ticker in enumerate(tickers):
        df_ticker = df_all[df_all["ticker"] == ticker]
        rows = process_ticker_indicators(ticker, df_ticker)
        all_rows.extend(rows)
        
        if (idx + 1) % 100 == 0 or idx + 1 == len(tickers):
            print(f"  -> 진행: {idx + 1}/{len(tickers)} ({len(all_rows):,}행 누적)")
    
    if not all_rows:
        print("❌ 지표 계산 결과 없음")
        return
    
    # STEP 3: DB 적재
    start_date = normalize_date(args.start) if args.start else ""
    end_date = normalize_date(args.end) if args.end else ""
    upsert_daily_indicators(all_rows, start_date=start_date, end_date=end_date)
    
    print("\n" + "="*60)
    print("✅ 완료!")
    print("="*60)


if __name__ == "__main__":
    main()
