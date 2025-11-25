#!/usr/bin/env python3
# 파일: scripts/update_sector_scores.py
# 설명: KRX 지수/업종 데이터 수집 -> 섹터 점수 계산 -> Supabase에 upsert
# 변경점 요약:
# - get_index_price_change 결과에서 "지수명"이 행 index에 있는 케이스를 안전하게 처리
# - ingest_df_safe 함수로 '지수명'(index) 우선사용, '등락률' 컬럼 우선 사용
# - 티커 기반 폴백, fuzzy 매칭 유지
# - 디버그 출력 추가 (수집된 지수명 샘플 등)

import os
import time
import traceback
import difflib
import pandas as pd
from supabase import create_client
from datetime import datetime, timedelta
from pykrx import stock

# ---------------------------
# 환경 변수 로드 (.env)
# ---------------------------
def load_env_file(filepath=".env"):
    try:
        with open(filepath, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    if key not in os.environ:
                        os.environ[key] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass

load_env_file()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ 에러: Supabase 키가 설정되어 있지 않습니다. (환경변수 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 또는 SUPABASE_SERVICE_KEY 확인)")
    exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---------------------------
# 유틸리티 함수
# ---------------------------
def safe_float(x, default=0.0):
    try:
        return float(x)
    except Exception:
        return default

def normalize_name(s):
    if s is None:
        return ""
    return str(s).strip()

def retry_call(func, attempts=3, wait=0.3, backoff=2.0):
    """간단한 재시도 래퍼"""
    last_exc = None
    delay = wait
    for i in range(attempts):
        try:
            return func()
        except Exception as e:
            last_exc = e
            print(f"   ⚠️ 시도 {i+1}/{attempts} 실패: {e}")
            traceback.print_exc()
            time.sleep(delay)
            delay *= backoff
    raise last_exc

# ---------------------------
# pykrx 호출 래퍼
# ---------------------------
def try_get_index_price_change(date, market):
    """pykrx.get_index_price_change -> DataFrame 또는 빈 DataFrame 반환"""
    try:
        return retry_call(lambda: stock.get_index_price_change(date, date, market), attempts=3, wait=0.2)
    except Exception:
        return pd.DataFrame()

def try_get_index_ticker_list(date, market):
    try:
        return retry_call(lambda: stock.get_index_ticker_list(date, market=market), attempts=3, wait=0.2) or []
    except Exception:
        return []

def try_get_index_ohlcv(date, ticker):
    try:
        return retry_call(lambda: stock.get_index_ohlcv(date, date, ticker), attempts=3, wait=0.2) or pd.DataFrame()
    except Exception:
        return pd.DataFrame()

def try_get_index_ticker_name(ticker):
    try:
        return stock.get_index_ticker_name(ticker)
    except Exception:
        return str(ticker)

# ---------------------------
# 안전한 ingest 함수: 지수명(index) 우선, '등락률' 컬럼 우선
# ---------------------------
def ingest_df_safe(df, sector_change_map):
    """
    DataFrame의 구조가 다양한 경우에도 안전하게 '지수명'과 '등락률'을 추출하여
    sector_change_map에 (이름->등락률) 형식으로 저장합니다.
    반환값: 추가한 항목 개수
    """
    cnt = 0
    if df is None or df.empty:
        return cnt

    # df의 index가 지수명으로 들어오는 경우가 많으므로 index를 우선 사용
    for idx, row in df.iterrows():
        # 1) 이름 추출 우선순위: '지수명' 컬럼 -> 행 index(라벨)
        name = None
        if '지수명' in df.columns:
            try:
                name = row.get('지수명')
            except Exception:
                name = None

        if not name:
            # idx가 문자열이면 그게 지수명일 가능성 높음 (예: '코스피 200')
            try:
                if isinstance(idx, str) and idx.strip():
                    name = idx
            except Exception:
                name = None

        if not name:
            # 이름을 못 얻으면 해당 행은 건너뜀
            continue

        name_norm = normalize_name(name)
        if not name_norm:
            continue

        # 2) 등락률 추출 우선순위: '등락률' 컬럼이 있으면 사용
        change = None
        for col in ['등락률', 'change', 'change_rate', '변동률']:
            if col in df.columns:
                try:
                    change = row.get(col)
                    break
                except Exception:
                    change = None

        # 3) 등락률 컬럼이 없으면 시가/종가로 계산 시도
        if change is None:
            try:
                if '시가' in df.columns and '종가' in df.columns:
                    open_p = row.get('시가')
                    close_p = row.get('종가')
                    if open_p is not None and float(open_p) != 0 and close_p is not None:
                        change = (float(close_p) - float(open_p)) / float(open_p) * 100.0
            except Exception:
                change = None

        # 4) 저장 (등락률이 None이면 0으로 안전 처리)
        sector_change_map[name_norm] = safe_float(change, 0.0)
        cnt += 1

    return cnt

# ---------------------------
# 메인: 섹터 점수 계산 & 저장
# ---------------------------
def calculate_sector_scores():
    print("🔄 섹터 스코어 업데이트 시작...")
    today = datetime.now().strftime("%Y%m%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")
    dates_to_try = [today, yesterday]

    # 1) DB에서 종목 로딩
    print("📥 Supabase에서 종목(stocks) 데이터 로딩...")
    try:
        res = supabase.table("stocks").select("code, name, sector_id, market_cap, universe_level").limit(5000).execute()
        data = getattr(res, "data", res)
        stocks_df = pd.DataFrame(data or [])
    except Exception as e:
        print("❌ Supabase에서 stocks 로드 실패:", e)
        traceback.print_exc()
        return

    if stocks_df.empty:
        print("⚠️ stocks 테이블이 비어있습니다.")
        return

    # sector_id가 없는 행 제거
    stocks_df = stocks_df[stocks_df['sector_id'].notna()].copy()
    if stocks_df.empty:
        print("⚠️ sector_id가 포함된 종목이 없습니다.")
        return

    # sector_name 정규화: "KRX:섹터명" -> "섹터명"
    stocks_df['sector_name'] = stocks_df['sector_id'].apply(lambda x: normalize_name(x.split(':')[-1] if ':' in str(x) else x))
    stocks_df['universe_level'] = stocks_df.get('universe_level', '').fillna('').astype(str)

    # 2) 업종/지수 등락률 수집 (우선 get_index_price_change -> 부족하면 티커 기반 폴백)
    sector_change_map = {}
    last_successful_date = None

    for target_date in dates_to_try:
        print(f"📊 {target_date} 기준 업종/지수 데이터 수집 시도...")
        try:
            # debug: 어떤 컬럼이 오는지 확인 (한 번만 출력)
            df_kospi = try_get_index_price_change(target_date, "KOSPI")
            df_kosdaq = try_get_index_price_change(target_date, "KOSDAQ")

            # 디버그 출력 (개발시 활용)
            print("DEBUG: df_kospi.columns =", list(df_kospi.columns) if isinstance(df_kospi, pd.DataFrame) else None)
            # print("DEBUG: df_kospi.head() =\n", df_kospi.head(5))

            # ingest safe 방식으로 df를 처리
            cnt_k = ingest_df_safe(df_kospi, sector_change_map)
            cnt_q = ingest_df_safe(df_kosdaq, sector_change_map)

            if (cnt_k + cnt_q) >= 10:
                last_successful_date = target_date
                print(f"   ✅ {target_date} 에서 충분한 지수({cnt_k + cnt_q}) 확보, 우선 사용합니다.")
                break  # 충분히 모였으므로 종료

            # 티커 기반 폴백 실행
            print(f"   ↪️ 수집량이 적음({cnt_k + cnt_q}). 티커 기반 폴백을 수행합니다.")
            for market in ("KOSPI", "KOSDAQ"):
                tickers = try_get_index_ticker_list(target_date, market)
                if not tickers:
                    print(f"   ⚠️ {market} 티커 리스트가 비어있음(또는 실패).")
                    continue
                for ticker in tickers:
                    try:
                        df = try_get_index_ohlcv(target_date, ticker)
                        if df.empty:
                            continue
                        # ohlcv는 index가 날짜라서, get_index_ticker_name으로 이름을 얻음
                        if '등락률' in df.columns:
                            change = df['등락률'].iloc[0]
                        else:
                            open_p = df['시가'].iloc[0] if '시가' in df.columns else None
                            close_p = df['종가'].iloc[0] if '종가' in df.columns else None
                            if open_p is not None and float(open_p) != 0 and close_p is not None:
                                change = ((float(close_p) - float(open_p)) / float(open_p) * 100)
                            else:
                                change = 0.0
                        name = try_get_index_ticker_name(ticker)
                        sector_change_map[normalize_name(name)] = safe_float(change, 0.0)
                    except Exception:
                        traceback.print_exc()
                        continue

            if sector_change_map:
                last_successful_date = target_date
                print(f"   ✅ 티커 기반 폴백으로 지수/업종 데이터 확보 (총:{len(sector_change_map)})")
                break
            else:
                print(f"   ⚠️ {target_date} 에서도 데이터 확보 실패, 다음 날짜 시도")
                continue

        except Exception as e:
            print("   ❌ 데이터 수집 루프 중 예외:", e)
            traceback.print_exc()
            continue

    # (C) 대표지수 폴백(모든 시도가 실패한 경우)
    if not sector_change_map:
        print("⚠️ 모든 시도에서 업종 데이터 확보 실패 -> 대표지수(1001/2001)로 폴백 시도")
        try:
            df_kospi_main = try_get_index_ohlcv(today, "1001") or try_get_index_ohlcv(yesterday, "1001")
            df_kosdaq_main = try_get_index_ohlcv(today, "2001") or try_get_index_ohlcv(yesterday, "2001")
            fallback_kospi = 0.0
            fallback_kosdaq = 0.0
            if not df_kospi_main.empty:
                fallback_kospi = safe_float(((df_kospi_main['종가'].iloc[0] - df_kospi_main['시가'].iloc[0]) / df_kospi_main['시가'].iloc[0] * 100), 0.0)
            if not df_kosdaq_main.empty:
                fallback_kosdaq = safe_float(((df_kosdaq_main['종가'].iloc[0] - df_kosdaq_main['시가'].iloc[0]) / df_kosdaq_main['시가'].iloc[0] * 100), 0.0)

            unique_sectors = stocks_df['sector_name'].unique().tolist()
            for s in unique_sectors:
                s_norm = normalize_name(s)
                if "코스닥" in s_norm or "KOSDAQ" in s_norm:
                    sector_change_map[s_norm] = fallback_kosdaq
                else:
                    sector_change_map[s_norm] = fallback_kospi
            print("   ↪️ 대표지수 폴백 적용 완료.")
        except Exception as e:
            print("   ❌ 대표지수 폴백 실패, 모든 섹터 등락률을 0으로 처리합니다.", e)
            traceback.print_exc()

    # ---------------------------
    # 섹터명 매핑 (DB의 sector_name -> 수집된 지수명)
    # ---------------------------
    print("🔎 수집된 지수 샘플(상위 30):", list(sector_change_map.keys())[:30])
    db_sector_names = [normalize_name(s) for s in stocks_df['sector_name'].unique().tolist()]
    collected_names = list(sector_change_map.keys())

    matches = {}
    for s in db_sector_names:
        if not s:
            matches[s] = None
            continue
        if s in sector_change_map:
            matches[s] = s
            continue
        # 부분 포함 검사
        found = None
        for cname in collected_names:
            if s and s in cname:
                found = cname
                break
            if cname and cname in s:
                found = cname
                break
        if found:
            matches[s] = found
            continue
        # difflib 기반 근사 매칭
        close = difflib.get_close_matches(s, collected_names, n=1, cutoff=0.6)
        if close:
            matches[s] = close[0]
        else:
            matches[s] = None

    matched_cnt = sum(1 for v in matches.values() if v)
    print(f"🔗 섹터명 대비 지수 매칭: {matched_cnt}/{len(matches)}")

    # final_sector_change_map: DB의 sector_name -> change_rate
    final_sector_change_map = {}
    for s in db_sector_names:
        mapped = matches.get(s)
        if mapped:
            final_sector_change_map[s] = sector_change_map.get(mapped, 0.0)
        else:
            # 매칭 실패 시 대표지수로 폴백: '코스닥' 포함 여부로 간단 판별
            if "코스닥" in s or "KOSDAQ" in s:
                final_sector_change_map[s] = sector_change_map.get("코스닥", 0.0)
            else:
                final_sector_change_map[s] = sector_change_map.get("코스피", 0.0)

    # ---------------------------
    # 섹터별 점수 계산 및 Supabase에 upsert
    # ---------------------------
    print("🚀 섹터 점수 계산 중...")
    sector_groups = stocks_df.groupby('sector_name')
    updates = []
    for sector_name, group in sector_groups:
        name = normalize_name(sector_name)
        core_count = len(group[group['universe_level'] == 'core'])
        change_rate = safe_float(final_sector_change_map.get(name, 0.0), 0.0)
        score = (change_rate * 10.0) + (core_count * 3.0)
        if score < 0:
            score = 0.0
        sector_id = f"KRX:{name}"
        updates.append({
            "id": sector_id,
            "name": name,
            "score": int(round(score)),
            "change_rate": float(round(change_rate, 6)),
            "updated_at": datetime.now().isoformat()
        })

    if updates:
        print(f"💾 {len(updates)}개 섹터 데이터 Supabase에 저장 중...")
        batch_size = 50
        for i in range(0, len(updates), batch_size):
            batch = updates[i:i+batch_size]
            try:
                resp = supabase.table("sectors").upsert(batch).execute()
            except Exception as e:
                print("   ❌ Supabase upsert 실패:", e)
                traceback.print_exc()
    else:
        print("⚠️ 업데이트할 섹터 데이터가 없습니다.")

    print("✅ 섹터 스코어 업데이트 완료.")

# ---------------------------
# 스크립트 엔트리
# ---------------------------
if __name__ == "__main__":
    calculate_sector_scores()
