import os
import pandas as pd
from supabase import create_client
from datetime import datetime, timedelta
from pykrx import stock
import time

# --- .env 로드 (동일) ---
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

def calculate_sector_scores():
    print("🔄 섹터 스코어 업데이트 시작...")
    today = datetime.now().strftime("%Y%m%d")
    
    # 최근 영업일 찾기 (오늘 포함 최근 5일 조회)
    target_date = today
    for i in range(5):
        d = (datetime.now() - timedelta(days=i)).strftime("%Y%m%d")
        # 간단히 KOSPI 지수 데이터가 있는지 확인하여 영업일인지 체크
        try:
            check = stock.get_index_ohlcv(d, d, "1001") # 1001: 코스피 지수
            if not check.empty:
                target_date = d
                print(f"📅 유효한 데이터 날짜 확인: {target_date}")
                break
        except: pass
    
    print("📥 DB에서 종목 데이터 로딩...")
    # stocks 조회 로직 (동일)
    res = supabase.table("stocks").select("code, name, sector_id, market_cap, universe_level").limit(5000).execute()
    stocks_df = pd.DataFrame(res.data)
    
    if stocks_df.empty:
        print("⚠️ stocks 테이블이 비어있습니다.")
        return

    stocks_df = stocks_df[stocks_df['sector_id'].notna()]
    stocks_df['sector_name'] = stocks_df['sector_id'].apply(lambda x: x.split(':')[-1] if ':' in x else x)
    
    print(f"📊 {target_date} 기준 업종별 등락률 수집 중 (OHLCV 방식)...")
    sector_change_map = {}

    for market in ["KOSPI", "KOSDAQ"]:
        try:
            # [수정] 등락률 API 대신 OHLCV API 사용
            # 모든 업종의 티커 리스트 가져오기
            tickers = stock.get_index_ticker_list(target_date, market=market)
            
            for ticker in tickers:
                name = stock.get_index_ticker_name(ticker)
                
                # 해당 업종의 OHLCV 조회
                df = stock.get_index_ohlcv(target_date, target_date, ticker)
                
                if not df.empty:
                    # 등락률 계산: (종가 - 시가) / 시가 * 100 (또는 전일비가 있다면 그것 사용)
                    # get_index_ohlcv 결과에는 '등락률' 컬럼이 포함되어 있을 수 있음
                    if '등락률' in df.columns:
                        change = df['등락률'].iloc[0]
                    else:
                        # 등락률이 없으면 (종가 - 시가)/시가 로 근사치 계산하거나 
                        # 전일 종가 대비 계산이 정확하지만, 여기선 시가 대비로 간략화
                        open_p = df['시가'].iloc[0]
                        close_p = df['종가'].iloc[0]
                        change = ((close_p - open_p) / open_p * 100) if open_p > 0 else 0
                    
                    sector_change_map[name] = change
                    
            print(f"   ✅ {market} 지수 데이터 확보 완료")
            
        except Exception as e:
            print(f"   ⚠️ {market} 데이터 수집 중 에러: {e}")

    # 2. 섹터별 점수 계산 (동일)
    sector_groups = stocks_df.groupby('sector_name')
    updates = []
    
    print(f"🚀 {len(sector_groups)}개 섹터 분석 중...")
    
    for sector_name, group in sector_groups:
        core_count = len(group[group['universe_level'] == 'core'])
        change_rate = sector_change_map.get(sector_name, 0.0)
        
        score = (change_rate * 10) + (core_count * 3)
        if score < 0: score = 0
        
        sector_id = f"KRX:{sector_name}" 
        
        updates.append({
            "id": sector_id,
            "name": sector_name,
            "score": int(round(score)),
            "change_rate": float(change_rate),
            "updated_at": datetime.now().isoformat()
        })
    
    # 3. 저장 (동일)
    if updates:
        print(f"💾 {len(updates)}개 섹터 데이터 저장 중...")
        batch_size = 50
        for i in range(0, len(updates), batch_size):
            batch = updates[i:i+batch_size]
            supabase.table("sectors").upsert(batch).execute()
            
    print("✅ 섹터 스코어 업데이트 완료.")

if __name__ == "__main__":
    calculate_sector_scores()
