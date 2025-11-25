import os
import time
import pandas as pd
import numpy as np
from pykrx import stock
from supabase import create_client
from datetime import datetime, timedelta

# --- .env 로드 ---
def load_env_file(filepath=".env"):
    try:
        with open(filepath, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"): continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    if key not in os.environ:
                        os.environ[key] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass

load_env_file()

# Supabase 설정
url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
supabase = create_client(url, key)

def calculate_rsi(series, period=14):
    delta = series.diff(1)
    gain = (delta.where(delta > 0, 0)).fillna(0)
    loss = (-delta.where(delta < 0, 0)).fillna(0)

    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()

    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def update_technical_indicators():
    print("🔄 기술적 지표(SMA, RSI) 업데이트 시작...")
    
    # 1. 관리 대상 종목만 조회 (Core/Extended) - 전체 종목은 너무 오래 걸림
    print("📥 대상 종목 리스트 조회 중...")
    res = supabase.table("stocks").select("code, name").in_("universe_level", ["core", "extended"]).execute()
    targets = res.data or []
    
    if not targets:
        print("⚠️ 업데이트할 대상 종목이 없습니다. (universe_level 설정 필요)")
        return

    print(f"🚀 {len(targets)}개 종목 지표 계산 시작...")
    
    # 날짜 범위 설정 (최근 100일 - 넉넉하게 잡음)
    end_date = datetime.now().strftime("%Y%m%d")
    start_date = (datetime.now() - timedelta(days=150)).strftime("%Y%m%d")
    
    success_count = 0
    
    for i, t in enumerate(targets):
        code = t['code']
        name = t['name']
        
        try:
            # OHLCV 데이터 가져오기
            df = stock.get_market_ohlcv(start_date, end_date, code)
            
            if df.empty or len(df) < 20:
                print(f"⚠️ 데이터 부족: {name}({code})")
                continue
                
            # 지표 계산
            close = df['종가']
            
            # SMA
            sma20 = close.rolling(window=20).mean().iloc[-1]
            sma50 = close.rolling(window=50).mean().iloc[-1]
            
            # RSI (Wilder's Smoothing 대신 단순 SMA 방식 적용 예시, 정밀도 필요시 수정 가능)
            rsi_series = calculate_rsi(close, 14)
            rsi14 = rsi_series.iloc[-1]
            
            # 현재가
            current_price = close.iloc[-1]
            
            # DB 업데이트 payload
            update_data = {
                "sma20": float(round(sma20, 2)) if not pd.isna(sma20) else None,
                "sma50": float(round(sma50, 2)) if not pd.isna(sma50) else None,
                "rsi14": float(round(rsi14, 2)) if not pd.isna(rsi14) else None,
                "close": int(current_price),  # 최신 종가로 갱신
                "updated_at": datetime.now().isoformat()
            }
            
            # 개별 업데이트 (배치보다 안전)
            supabase.table("stocks").update(update_data).eq("code", code).execute()
            
            print(f"[{i+1}/{len(targets)}] ✅ {name}: Close={current_price}, SMA20={update_data['sma20']}, RSI={update_data['rsi14']}")
            success_count += 1
            
            # API 호출 제한 고려 (필요시 sleep)
            # time.sleep(0.1) 
            
        except Exception as e:
            print(f"❌ 실패 {name}({code}): {e}")
            continue

    print(f"🎉 업데이트 완료: 총 {success_count}개 종목 처리됨.")

if __name__ == "__main__":
    update_technical_indicators()
