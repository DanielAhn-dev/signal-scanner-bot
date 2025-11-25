# scripts/update_market_data.py
import os
from pykrx import stock
import pandas as pd
from supabase import create_client
from datetime import datetime

# --- .env 로드 함수 ---
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
    except FileNotFoundError: pass

load_env_file()

# Supabase 설정
url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
if not url or not key:
    print("❌ 에러: 키 설정 확인 필요")
    exit(1)

supabase = create_client(url, key)

def update_universe_and_fundamentals():
    today = datetime.now().strftime("%Y%m%d")
    print(f"📅 기준일: {today} 데이터 수집 시작...")
    
    try:
        # 1. 티커 리스트 가져오기
        print("📊 티커 리스트 수집 중...")
        tickers_kospi = stock.get_market_ticker_list(today, market="KOSPI")
        tickers_kosdaq = stock.get_market_ticker_list(today, market="KOSDAQ")
        
        if not tickers_kospi:
            print("⚠️ 휴장일이거나 데이터가 없습니다.")
            return

        # 2. 종목명 매핑 (이 부분이 추가됨)
        print("📝 종목명 매핑 중...")
        name_map = {}
        for ticker in tickers_kospi:
            name = stock.get_market_ticker_name(ticker)
            name_map[ticker] = name
            
        for ticker in tickers_kosdaq:
            name = stock.get_market_ticker_name(ticker)
            name_map[ticker] = name

        # 3. 시가총액 및 펀더멘털 수집
        print("📊 시가총액/펀더멘털 데이터 수집 중...")
        df_kospi = stock.get_market_cap(today, market="KOSPI")
        df_kosdaq = stock.get_market_cap(today, market="KOSDAQ")
        
        fund_kospi = stock.get_market_fundamental(today, market="KOSPI")
        fund_kosdaq = stock.get_market_fundamental(today, market="KOSDAQ")
        
        df_total = pd.concat([df_kospi, df_kosdaq])
        fund_total = pd.concat([fund_kospi, fund_kosdaq])
        
        df_total = df_total.join(fund_total[['PER', 'PBR']], how='left')
        
        # 4. 랭킹 및 유니버스
        df_total = df_total.sort_values(by='시가총액', ascending=False)
        df_total['rank'] = range(1, len(df_total) + 1)
        
        updates = []
        print(f"🚀 총 {len(df_total)}개 종목 업로드 시작...")
        
        for ticker, row in df_total.iterrows():
            # 종목명이 없으면 티커로 대체하거나 스킵 (DB 제약조건 준수)
            stock_name = name_map.get(ticker)
            if not stock_name:
                stock_name = ticker # 임시 방편
                
            price = row['종가']
            mcap = row['시가총액']
            rank = row['rank']
            
            per = row['PER'] if pd.notnull(row['PER']) and row['PER'] > 0 else None
            pbr = row['PBR'] if pd.notnull(row['PBR']) and row['PBR'] > 0 else None
            volume = row['거래량']
            
            universe_level = 'tail'
            if price >= 1000:
                if rank <= 200: universe_level = 'core'
                elif rank <= 500: universe_level = 'extended'
            
            updates.append({
                "code": ticker,
                "name": stock_name, # [추가됨] NOT NULL 해결
                "market_cap": int(mcap),
                "mcap_rank": int(rank),
                "universe_level": universe_level,
                "per": float(per) if per else None,
                "pbr": float(pbr) if pbr else None,
                "avg_volume_20d": int(volume)
            })
            
            if len(updates) >= 100:
                supabase.table("stocks").upsert(updates).execute()
                updates = []
                
        if updates:
            supabase.table("stocks").upsert(updates).execute()

        print("✅ 업데이트 완료.")
        
    except Exception as e:
        print(f"❌ 에러 발생: {e}")

if __name__ == "__main__":
    update_universe_and_fundamentals()
