import os
import pandas as pd
from supabase import create_client
from pykrx import stock
from datetime import datetime
import time

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

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
supabase = create_client(url, key)

def fetch_all_stocks():
    """기존 종목 정보 로딩 (생략 가능하지만 안전을 위해 유지)"""
    all_data = []
    page = 0
    page_size = 1000 
    print("📥 기존 종목 정보 로딩 시작...")
    while True:
        start = page * page_size
        end = start + page_size - 1
        res = supabase.table("stocks").select("code, name").range(start, end).execute()
        data = res.data
        if not data: break
        all_data.extend(data)
        if len(data) < page_size: break
        page += 1
        time.sleep(0.1)
    return {item['code']: item['name'] for item in all_data}

def map_sectors():
    print("🔄 종목별 섹터 매핑 시작...")
    today = datetime.now().strftime("%Y%m%d")
    name_map = fetch_all_stocks()

    markets = ["KOSPI", "KOSDAQ"]
    
    # 1. 업데이트할 데이터 수집
    stock_updates = []
    sector_inserts = {} # 중복 제거를 위해 딕셔너리 사용 (sector_id -> name)

    print("📊 KRX 섹터 정보 수집 중...")
    for market in markets:
        sectors = stock.get_index_ticker_list(today, market=market)
        print(f"   👉 {market}: 총 {len(sectors)}개 섹터 스캔 중...")
        
        for i, sector_code in enumerate(sectors):
            sector_name = stock.get_index_ticker_name(sector_code)
            sector_id = f"KRX:{sector_name}"
            
            # [중요] sectors 테이블에 넣을 데이터 준비
            sector_inserts[sector_id] = sector_name
            
            tickers = stock.get_index_portfolio_deposit_file(sector_code)
            
            if i % 10 == 0:
                print(f"      [{i}/{len(sectors)}] {sector_name} ({len(tickers)}종목)...")
            
            for ticker in tickers:
                stock_name = name_map.get(ticker)
                if not stock_name:
                    try:
                        stock_name = stock.get_market_ticker_name(ticker)
                        if stock_name: name_map[ticker] = stock_name 
                    except:
                        stock_name = ticker 
                
                if stock_name: 
                    stock_updates.append({
                        "code": ticker,
                        "name": stock_name, 
                        "sector_id": sector_id
                    })

    # 2. [핵심 수정] sectors 테이블에 없는 섹터 ID 먼저 등록 (FK 제약 해결)
    print(f"🏗️ 총 {len(sector_inserts)}개 섹터 정보 동기화 중...")
    sector_batch_data = [
        {"id": sid, "name": sname, "updated_at": datetime.now().isoformat()} 
        for sid, sname in sector_inserts.items()
    ]
    
    # 섹터 정보 일괄 업로드 (이미 있으면 업데이트)
    sector_batch_size = 100
    for i in range(0, len(sector_batch_data), sector_batch_size):
        batch = sector_batch_data[i:i+sector_batch_size]
        try:
            # score, change_rate 등은 update_sector_scores.py에서 계산하므로 여기선 기본정보만
            supabase.table("sectors").upsert(batch).execute() 
        except Exception as e:
            print(f"⚠️ 섹터 등록 에러: {e}")

    # 3. stocks 테이블 업데이트 (이제 FK 에러 안 남)
    unique_updates_map = {item['code']: item for item in stock_updates}
    final_updates = list(unique_updates_map.values())

    print(f"🚀 총 {len(final_updates)}개 종목 섹터 정보 업데이트 시작...")
    
    stock_batch_size = 100
    total_batches = (len(final_updates) + stock_batch_size - 1) // stock_batch_size
    
    for i in range(0, len(final_updates), stock_batch_size):
        batch = final_updates[i:i+stock_batch_size]
        try:
            supabase.table("stocks").upsert(batch).execute()
            current_batch = (i // stock_batch_size) + 1
            print(f"   💾 업로드 중... ({current_batch}/{total_batches})", end='\r')
        except Exception as e:
            print(f"\n⚠️ 종목 업데이트 에러: {e}")
            
    print("\n✅ 섹터 매핑 및 종목 업데이트 완료.")

if __name__ == "__main__":
    map_sectors()
