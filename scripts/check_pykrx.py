# scripts/check_pykrx.py
from datetime import date, timedelta
from pykrx import stock
import pandas as pd
import time

# pandas 출력 옵션 설정 (터미널에서 모든 컬럼을 볼 수 있도록)
pd.set_option('display.max_columns', None)
pd.set_option('display.width', 1000)

def check_investor_data():
    """
    최근 5일치 영업일에 대해 투자자별 거래대금 및 KOSPI 시세를 조회하여
    데이터가 없는 원인을 진단한다.
    """
    today = date.today()
    checked_days = 0
    
    print("="*60)
    print("PyKRX 투자자별 거래대금 / KOSPI 시세 교차 조회 테스트")
    print("="*60)

    for i in range(15): # 2주 정도 기간을 넉넉하게 확인
        if checked_days >= 5:
            break
            
        d = today - timedelta(days=i)
        if d.weekday() >= 5: # 주말 건너뛰기
            continue

        day_str = d.strftime("%Y%m%d")
        print(f"\n[INFO] {day_str} ({d.strftime('%a')}) 데이터 조회 시도...")

        is_trading_day_by_ohlcv = False
        
        # --- 1. KOSPI 시세 조회 (영업일 판단용) ---
        try:
            df_kospi = stock.get_index_ohlcv(day_str, day_str, "1001") # 1001 = KOSPI
            if df_kospi.empty:
                print(f"  [KOSPI] 시세 데이터 없음 (Empty DataFrame)")
                is_trading_day_by_ohlcv = False
            else:
                print(f"  [KOSPI] 시세 조회 성공. (종가: {df_kospi.iloc[0]['종가']})")
                
                # --- 💡 수정된 부분: 성공한 데이터의 구조(키) 출력 ---
                print(f"  [KOSPI] KOSPI 시세 데이터 구조 (df_kospi.head(1)):")
                print(df_kospi.head(1))
                print(f"  [KOSPI] 컬럼 (키) 목록: {df_kospi.columns.tolist()}")
                # --- 💡 수정된 부분 끝 ---
                
                is_trading_day_by_ohlcv = True
        except Exception as e:
            print(f"  [KOSPI] 시세 조회 중 에러: {e}")
            is_trading_day_by_ohlcv = False # 에러 발생 시 영업일이 아닌 것으로 간주

        # --- 2. 투자자별 거래대금 조회 ---
        try:
            # KRX 서버 부하를 줄이기 위해 약간의 딜레이 추가
            time.sleep(0.5) 
            
            df_investor = stock.get_market_trading_value_by_date(day_str, day_str, "005930")
            
            if df_investor.empty:
                print(f"  [INVESTOR] 투자자별 데이터 없음 (Empty DataFrame)")
                
                # --- 💡 원인 진단 💡 ---
                if not is_trading_day_by_ohlcv:
                    print(f"  -> [진단] {day_str}은(는) 휴장일(공휴일/주말)이 확실합니다.")
                else:
                    print(f"  -> [경고] {day_str}은(는) 영업일이나, 투자자별 데이터만 누락되었습니다. (데이터 소스 문제)")
                
                continue # 다음 날짜로
            
            print(f"  [INVESTOR] 데이터 조회 성공! (총 {len(df_investor)}개 종목)")
            
            # --- 💡 추가된 부분: 성공 시 투자자별 데이터 구조(키) 출력 ---
            print(f"  [INVESTOR] 투자자별 데이터 구조 (df_investor.head(1)):")
            print(df_investor.head(1))
            print(f"  [INVESTOR] 컬럼 (키) 목록: {df_investor.columns.tolist()}")
            # --- 💡 추가된 부분 끝 ---
            
            # '외국인합계' 또는 '기관합계'가 0이 아닌 데이터가 있는지 확인
            has_foreign_data = (df_investor['외국인합계'] != 0).any()
            has_inst_data = (df_investor['기관합계'] != 0).any()
            
            print(f"    - 외국인 순매수: {'있음' if has_foreign_data else '없음 (전부 0)'}")
            print(f"    - 기관 순매수: {'있음' if has_inst_data else '없음 (전부 0)'}")

            if not has_foreign_data and not has_inst_data:
                if d == today:
                    print(f"  -> [진단] {day_str} (오늘) 데이터는 아직 집계 전입니다. (저녁 8시 이후 권장)")
                else:
                    print(f"  -> [경고] {day_str} (과거) 데이터의 수급이 모두 0입니다. (실제 0이거나 데이터 오류)")
            
            checked_days += 1

        except Exception as e:
            print(f"  [INVESTOR] 조회 중 에러 발생: {e}")

if __name__ == "__main__":
    check_investor_data()