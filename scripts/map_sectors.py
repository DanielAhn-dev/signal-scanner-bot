import os
import time
from datetime import datetime
import pandas as pd
from pykrx import stock
from supabase import create_client

# --- 환경 변수 및 Supabase 설정 ---
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

if not url or not key:
    print("❌ 에러: Supabase 환경변수가 설정되지 않았습니다.")
    exit(1)

supabase = create_client(url, key)

# --- 헬퍼 함수 ---
def fetch_all_stocks():
    """기존 종목 정보 로딩"""
    all_data = []
    page = 0
    page_size = 1000
    print("📥 기존 종목 정보 로딩 시작...")
    
    while True:
        start = page * page_size
        end = start + page_size - 1
        try:
            res = supabase.table("stocks").select("code, name").range(start, end).execute()
            data = res.data
            if not data: break
            all_data.extend(data)
            if len(data) < page_size: break
            page += 1
            time.sleep(0.1)
        except Exception as e:
            print(f"⚠️ 종목 로딩 중 에러: {e}")
            break
            
    return {item['code']: item['name'] for item in all_data}

# --- 메인 로직 ---
def map_sectors():
    print("🔄 종목별 섹터 매핑 시작...")
    today = datetime.now().strftime("%Y%m%d")
    
    # 기존 DB에 있는 종목명 캐싱 (불필요한 API 호출 최소화)
    name_map = fetch_all_stocks()

    markets = ["KOSPI", "KOSDAQ"]
    
    # 1. 업데이트할 데이터 수집
    stock_updates = []
    sector_inserts = {} # 중복 제거를 위해 딕셔너리 사용 (sector_id -> name)

    # 🚫 [추가됨] 매핑에서 제외할 키워드 목록 (광범위 지수, 파생, 테마 등)
    # 이 키워드가 포함된 섹터는 종목 매핑에 사용하지 않습니다.
    SKIP_KEYWORDS = [
        "200", "150", "100", "50", "KRX 300", "TOP", "Top", # 대표 지수/사이즈
        "레버리지", "인버스", "선물", "옵션",    # 파생상품
        "배당", "ESG", "우량", "밸류", "모멘텀", "LowVol", # 테마/스타일
        "종합", "대형주", "중형주", "소형주",    # 시장 사이즈
        "K-", "아시아", "글로벌", "달러", "엔",  # 지역/통화
        "섹터지수", "바이오헬스", "방송통신"      # 너무 포괄적이거나 중복되는 일부 테마
    ]

    print("📊 KRX 섹터 정보 수집 중...")
    for market in markets:
        # 해당 시장의 모든 지수 목록 가져오기
        sectors = stock.get_index_ticker_list(today, market=market)
        print(f"   👉 {market}: 총 {len(sectors)}개 섹터 스캔 중...")
        
        for i, sector_code in enumerate(sectors):
            sector_name = stock.get_index_ticker_name(sector_code)
            
            # 🛡️ [필터링 로직] 제외 키워드가 포함되어 있는지 확인
            if any(keyword in sector_name for keyword in SKIP_KEYWORDS):
                # 예: "코스피 200", "코스닥 150 레버리지" 등은 건너뜀
                continue

            sector_id = f"KRX:{sector_name}"
            
            # sectors 테이블용 데이터 준비
            sector_inserts[sector_id] = sector_name
            
            # 해당 섹터(지수)에 포함된 종목 리스트 가져오기
            tickers = stock.get_index_portfolio_deposit_file(sector_code)
            
            if i % 20 == 0:
                print(f"      [{i}/{len(sectors)}] {sector_name} ({len(tickers)}종목)...")
            
            for ticker in tickers:
                # 종목명이 없으면 DB나 API에서 찾기
                stock_name = name_map.get(ticker)
                if not stock_name:
                    try:
                        stock_name = stock.get_market_ticker_name(ticker)
                        if stock_name: name_map[ticker] = stock_name 
                        time.sleep(0.05) # API 호출 시 약간의 딜레이
                    except:
                        stock_name = ticker 
                
                if stock_name: 
                    stock_updates.append({
                        "code": ticker,
                        "name": stock_name, 
                        "sector_id": sector_id  # 여기에 구체적인 업종명이 들어감
                    })

    # 2. sectors 테이블에 없는 섹터 ID 먼저 등록 (FK 제약 해결)
    print(f"\n🏗️ 총 {len(sector_inserts)}개 유효 섹터 정보 동기화 중...")
    sector_batch_data = [
        {"id": sid, "name": sname, "updated_at": datetime.now().isoformat()} 
        for sid, sname in sector_inserts.items()
    ]
    
    # 섹터 정보 일괄 업로드
    sector_batch_size = 100
    for i in range(0, len(sector_batch_data), sector_batch_size):
        batch = sector_batch_data[i:i+sector_batch_size]
        try:
            # metrics, score 등은 유지하면서 기본 정보만 업데이트 (upsert)
            supabase.table("sectors").upsert(batch).execute() 
        except Exception as e:
            print(f"⚠️ 섹터 등록 에러: {e}")

    # 3. stocks 테이블 업데이트 (이제 FK 에러 안 남음)
    # 딕셔너리를 사용해 중복 제거 (한 종목이 여러 섹터에 걸릴 경우, 마지막으로 처리된 유효 섹터가 적용됨)
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
