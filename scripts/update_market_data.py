# scripts/update_market_data.py

import os
from pykrx import stock
import pandas as pd
from supabase import create_client
from datetime import datetime

# Supabase 설정
url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")
supabase = create_client(url, key)

def update_universe_and_fundamentals():
    today = datetime.now().strftime("%Y%m%d")
    
    # 1. 전체 종목 기본 정보 (KOSPI + KOSDAQ)
    tickers_kospi = stock.get_market_ticker_list(today, market="KOSPI")
    tickers_kosdaq = stock.get_market_ticker_list(today, market="KOSDAQ")
    
    # 2. 시가총액 및 펀더멘털 데이터 수집
    df_kospi = stock.get_market_cap(today, market="KOSPI")
    df_kosdaq = stock.get_market_cap(today, market="KOSDAQ")
    
    # 펀더멘털(PER/PBR) - pykrx get_market_fundamental 사용
    fund_kospi = stock.get_market_fundamental(today, market="KOSPI")
    fund_kosdaq = stock.get_market_fundamental(today, market="KOSDAQ")
    
    # 데이터 병합 (시총 + 펀더멘털)
    df_total = pd.concat([df_kospi, df_kosdaq])
    fund_total = pd.concat([fund_kospi, fund_kosdaq])
    
    # 공통 컬럼 기준으로 join (인덱스가 티커임)
    df_total = df_total.join(fund_total[['PER', 'PBR']], how='left')
    
    # 3. 유니버스 로직 적용 (전체 통합 랭킹)
    # 시가총액 기준 내림차순 정렬
    df_total = df_total.sort_values(by='시가총액', ascending=False)
    df_total['rank'] = range(1, len(df_total) + 1)
    
    updates = []
    
    for ticker, row in df_total.iterrows():
        price = row['종가']
        mcap = row['시가총액']
        rank = row['rank']
        per = row['PER'] if row['PER'] > 0 else None # 0이거나 에러값 처리
        pbr = row['PBR']
        volume = row['거래량'] # 당일 거래량 (또는 별도 함수로 20일 평균 계산 필요)
        
        # 유니버스 레벨 정의
        universe_level = 'tail'
        is_sector_leader = False
        
        # 조건: 가격 1000원 이상 & 거래량 필터 (예시)
        if price >= 1000:
            if rank <= 200:
                universe_level = 'core' # 대형주
            elif rank <= 500:
                universe_level = 'extended' # 중형주
        
        # 섹터별 대장주 로직은 별도 섹터 테이블과 조인하여 시총 1~3위를 True로 설정 (여기서는 생략)

        updates.append({
            "code": ticker,
            "market_cap": int(mcap),
            "mcap_rank": int(rank),
            "universe_level": universe_level,
            "per": float(per) if per else None,
            "pbr": float(pbr) if pbr else None,
            "avg_volume_20d": int(volume) # 임시로 당일 거래량 매핑
        })
        
        # 배치 처리를 위해 100개씩 upsert 권장
        if len(updates) >= 100:
            supabase.table("stocks").upsert(updates).execute()
            updates = []

    if updates:
        supabase.table("stocks").upsert(updates).execute()

    print("Universe Update Complete.")

if __name__ == "__main__":
    update_universe_and_fundamentals()
