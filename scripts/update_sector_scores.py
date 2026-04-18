#!/usr/bin/env python3
# 파일: scripts/update_sector_scores.py
# 설명: KRX 지수/업종 데이터 및 수급 데이터 수집 -> 섹터 점수 계산 -> Supabase에 upsert

import os
import time
import json
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
    print("❌ 에러: Supabase 키가 설정되어 있지 않습니다.")
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

def get_biz_days_ago(date_str, n):
    """단순 영업일 역산 (공휴일 미고려, 주말만 제외)"""
    dt = datetime.strptime(date_str, "%Y%m%d")
    cnt = 0
    while cnt < n:
        dt -= timedelta(days=1)
        if dt.weekday() < 5: # 월~금
            cnt += 1
    return dt.strftime("%Y%m%d")

def retry_call(func, attempts=3, wait=0.3, backoff=2.0):
    last_exc = None
    delay = wait
    for i in range(attempts):
        try:
            return func()
        except Exception as e:
            last_exc = e
            # print(f"   ⚠️ 잠시 대기 후 재시도... ({e})")
            time.sleep(delay)
            delay *= backoff
    raise last_exc

# ---------------------------
# pykrx 호출 래퍼
# ---------------------------
def try_get_index_price_change(date, market):
    try:
        return retry_call(lambda: stock.get_index_price_change(date, date, market), attempts=3, wait=0.5)
    except Exception:
        return pd.DataFrame()

def try_get_index_ticker_list(date, market):
    try:
        return retry_call(lambda: stock.get_index_ticker_list(date, market=market), attempts=3, wait=0.5) or []
    except Exception:
        return []

def try_get_index_ohlcv(date, ticker):
    try:
        return retry_call(lambda: stock.get_index_ohlcv(date, date, ticker), attempts=3, wait=0.5) or pd.DataFrame()
    except Exception:
        return pd.DataFrame()

def try_get_index_ticker_name(ticker):
    try:
        return stock.get_index_ticker_name(ticker)
    except Exception:
        return str(ticker)

def try_get_market_price_change_by_ticker(date, market):
    try:
        return retry_call(
            lambda: stock.get_market_price_change_by_ticker(date, date, market=market),
            attempts=3,
            wait=0.5,
        )
    except Exception:
        return pd.DataFrame()

# ---------------------------
# 수급 데이터 수집 함수
# ---------------------------
def get_sector_flows(stocks_df, today_str, stock_change_map=None):
    """
    종목별 투자자 순매수 데이터를 수집하여 섹터별로 집계
        반환: {
            sector_name: {
                flow_foreign_5d, flow_inst_5d, flow_foreign_20d, flow_inst_20d,
                cap_weighted_flow_5d, breadth_ratio, leader_rs
            }
        }
    """
    print("🌊 섹터별 수급 데이터 집계 시작 (시간이 걸릴 수 있습니다)...")
    
    # 1. 기간 설정
    date_5d_ago = get_biz_days_ago(today_str, 5)
    date_20d_ago = get_biz_days_ago(today_str, 20)
    
    # 수급 데이터를 담을 딕셔너리
    sector_flows = {}
    
    # 섹터별로 종목 그룹화
    grouped = stocks_df.groupby('sector_name')
    
    total_sectors = len(grouped)
    current_idx = 0
    
    for sector_name, group in grouped:
        current_idx += 1
        # 진행 상황 로깅 (너무 많으면 줄여도 됨)
        print(f"   [{current_idx}/{total_sectors}] {sector_name} 수급 집계 중 ({len(group)}종목)...")
        
        # 상위 10개 종목만 샘플링 (속도 최적화)
        top_stocks = group.sort_values('market_cap', ascending=False).head(10)
        
        f5_sum = 0
        i5_sum = 0
        f20_sum = 0
        i20_sum = 0
        weighted_flow_5d_sum = 0.0
        weight_sum = 0.0
        
        for _, row in top_stocks.iterrows():
            code = row['code']
            try:
                # 최근 20일 투자자별 순매수
                df_inv = retry_call(
                    lambda: stock.get_market_net_purchases_of_equities_by_ticker(date_20d_ago, today_str, code),
                    attempts=2, wait=0.3
                )
                
                if df_inv is None or df_inv.empty:
                    continue
                
                # 최근 5일 투자자별 순매수 (별도 호출)
                df_5d = retry_call(
                    lambda: stock.get_market_net_purchases_of_equities_by_ticker(date_5d_ago, today_str, code),
                    attempts=2, wait=0.2
                )
                
                # 5일치 합산
                     if not df_5d.empty:
                            try:
                                f5 = int(df_5d.loc['외국인', '순매수거래대금'])
                                i5 = int(df_5d.loc['기관합계', '순매수거래대금'])
                                f5_sum += f5
                                i5_sum += i5
                                cap = safe_float(row.get('market_cap', 0), 0.0)
                                if cap > 0:
                                     weighted_flow_5d_sum += (f5 + i5) * cap
                                     weight_sum += cap
                            except KeyError:
                                pass

                # 20일치 합산
                try:
                    f20_sum += int(df_inv.loc['외국인', '순매수거래대금'])
                    i20_sum += int(df_inv.loc['기관합계', '순매수거래대금'])
                except KeyError:
                    pass

            except Exception as e:
                continue
        
        cap_weighted_flow_5d = (weighted_flow_5d_sum / weight_sum) if weight_sum > 0 else 0.0

        sector_changes = [
            safe_float(stock_change_map.get(str(c), 0.0), 0.0)
            for c in group['code'].tolist()
            if stock_change_map and str(c) in stock_change_map
        ]
        breadth_ratio = (
            len([chg for chg in sector_changes if chg > 0]) / len(sector_changes)
            if sector_changes
            else 0.0
        )

        leader_changes = []
        if stock_change_map:
            leaders = group.sort_values('market_cap', ascending=False).head(3)
            for _, leader in leaders.iterrows():
                code = str(leader.get('code', ''))
                if code in stock_change_map:
                    leader_changes.append(safe_float(stock_change_map.get(code), 0.0))
        leader_strength = sum(leader_changes) / len(leader_changes) if leader_changes else 0.0

        sector_flows[sector_name] = {
            "flow_foreign_5d": f5_sum,
            "flow_inst_5d": i5_sum,
            "flow_foreign_20d": f20_sum,
            "flow_inst_20d": i20_sum,
            "cap_weighted_flow_5d": cap_weighted_flow_5d,
            "breadth_ratio": breadth_ratio,
            "leader_strength": leader_strength,
        }
        
    return sector_flows


# ---------------------------
# 안전한 ingest 함수
# ---------------------------
def ingest_df_safe(df, sector_change_map):
    cnt = 0
    if df is None or df.empty:
        return cnt

    for idx, row in df.iterrows():
        name = None
        if '지수명' in df.columns:
            name = row.get('지수명')
        if not name and isinstance(idx, str):
            name = idx
            
        if not name: continue
        
        name_norm = normalize_name(name)
        if not name_norm: continue

        change = None
        for col in ['등락률', 'change', 'change_rate', '변동률']:
            if col in df.columns:
                change = row.get(col)
                break
        
        if change is None:
            try:
                if '시가' in df.columns and '종가' in df.columns:
                    o = float(row['시가'])
                    c = float(row['종가'])
                    if o != 0:
                        change = (c - o) / o * 100.0
            except: pass
            
        sector_change_map[name_norm] = safe_float(change, 0.0)
        cnt += 1
    return cnt

# ---------------------------
# 메인: 섹터 점수 계산 & 저장
# ---------------------------
def calculate_sector_scores():
    print("🔄 섹터 스코어 및 수급 데이터 업데이트 시작...")
    today = datetime.now().strftime("%Y%m%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")
    
    # 1) DB에서 종목 로딩
    print("📥 Supabase에서 종목(stocks) 데이터 로딩...")
    try:
        res = supabase.table("stocks").select("code, name, sector_id, market_cap, universe_level").execute()
        data = getattr(res, "data", res)
        stocks_df = pd.DataFrame(data or [])
    except Exception as e:
        print("❌ Supabase에서 stocks 로드 실패:", e)
        traceback.print_exc()
        return

    if stocks_df.empty:
        print("⚠️ stocks 테이블이 비어있습니다.")
        return

    # 전처리
    stocks_df = stocks_df[stocks_df['sector_id'].notna()].copy()
    stocks_df['sector_name'] = stocks_df['sector_id'].apply(lambda x: normalize_name(x.split(':')[-1] if ':' in str(x) else x))
    stocks_df['market_cap'] = pd.to_numeric(stocks_df['market_cap'], errors='coerce').fillna(0)
    
    # universe_level 문자열 처리 (NaN 방지)
    stocks_df['universe_level'] = stocks_df['universe_level'].fillna('').astype(str)

    # 2) 업종/지수 등락률 수집
    sector_change_map = {}
    dates_to_try = [today, yesterday]
    
    for target_date in dates_to_try:
        print(f"📊 {target_date} 기준 지수 등락률 수집 시도...")
        try:
            df_k = try_get_index_price_change(target_date, "KOSPI")
            df_q = try_get_index_price_change(target_date, "KOSDAQ")
            
            cnt = ingest_df_safe(df_k, sector_change_map)
            cnt += ingest_df_safe(df_q, sector_change_map)
            
            if cnt >= 10:
                print(f"   ✅ {target_date} 데이터 확보 완료.")
                break
            
            print("   ↪️ 데이터 부족, 티커 기반 폴백...")
            for mkt in ["KOSPI", "KOSDAQ"]:
                ticks = try_get_index_ticker_list(target_date, mkt)
                for t in ticks:
                    df = try_get_index_ohlcv(target_date, t)
                    if df.empty: continue
                    
                    change = 0.0
                    if '등락률' in df.columns: change = df['등락률'].iloc[0]
                    elif '종가' in df.columns and '시가' in df.columns:
                         c, o = df['종가'].iloc[0], df['시가'].iloc[0]
                         if o > 0: change = (c-o)/o*100
                    
                    nm = try_get_index_ticker_name(t)
                    sector_change_map[normalize_name(nm)] = safe_float(change)
            
            if sector_change_map: break
            
        except Exception as e:
            print(f"   ❌ {target_date} 수집 중 에러: {e}")

    # 3) 종목 등락률 맵 확보 (breadth / 리더 상대강도 계산용)
    stock_change_map = {}
    try:
        for market in ["KOSPI", "KOSDAQ"]:
            df_chg = try_get_market_price_change_by_ticker(today, market)
            if df_chg is None or df_chg.empty:
                continue
            for idx, row in df_chg.iterrows():
                code = str(idx).strip()
                if not code:
                    continue
                val = None
                for col in ['등락률', '변동률', 'change_rate', 'change']:
                    if col in df_chg.columns:
                        val = row.get(col)
                        break
                stock_change_map[code] = safe_float(val, 0.0)
    except Exception:
        stock_change_map = {}

    # 4) 섹터별 수급/구성 지표 집계
    sector_flows = get_sector_flows(stocks_df, today, stock_change_map)

    # 5) 매칭 및 점수 계산
    db_sector_names = stocks_df['sector_name'].unique().tolist()
    
    matches = {}
    collected_names = list(sector_change_map.keys())
    
    for s in db_sector_names:
        s_norm = normalize_name(s)
        if not s_norm: continue
        
        if s_norm in sector_change_map:
            matches[s] = s_norm
            continue
            
        found = next((c for c in collected_names if s_norm in c or c in s_norm), None)
        if found:
            matches[s] = found
            continue
            
        close = difflib.get_close_matches(s_norm, collected_names, n=1, cutoff=0.6)
        if close:
            matches[s] = close[0]
        else:
            matches[s] = None

    print("🚀 데이터 병합 및 저장 준비...")
    sector_groups = stocks_df.groupby('sector_name')
    updates = []
    
    for sector_name, group in sector_groups:
        name = normalize_name(sector_name)
        
        matched_name = matches.get(sector_name)
        change_rate = 0.0
        if matched_name:
            change_rate = sector_change_map.get(matched_name, 0.0)
        else:
            change_rate = sector_change_map.get("코스닥", 0.0) if "코스닥" in name else sector_change_map.get("코스피", 0.0)
            
        flows = sector_flows.get(sector_name, {})
        
        # ✅ [FIXED] 올바른 Pandas 필터링 문법 사용
        core_count = len(group[group['universe_level'] == 'core'])
        
        breadth_ratio = safe_float(flows.get("breadth_ratio", 0.0), 0.0)
        cap_weighted_flow_5d = safe_float(flows.get("cap_weighted_flow_5d", 0.0), 0.0)
        leader_strength = safe_float(flows.get("leader_strength", 0.0), 0.0)
        leader_rs = leader_strength - change_rate

        flow_norm = cap_weighted_flow_5d / 1e10
        breadth_score = max(-8.0, min(8.0, (breadth_ratio - 0.5) * 20.0))
        flow_score = max(-8.0, min(8.0, flow_norm))
        leader_score = max(-6.0, min(6.0, leader_rs * 1.5))

        score = (
            (change_rate * 8.0)
            + (core_count * 2.0)
            + breadth_score
            + flow_score
            + leader_score
        )
        if score < 0: score = 0
        
        metrics = {
            "flow_foreign_5d": flows.get("flow_foreign_5d", 0),
            "flow_inst_5d": flows.get("flow_inst_5d", 0),
            "flow_foreign_20d": flows.get("flow_foreign_20d", 0),
            "flow_inst_20d": flows.get("flow_inst_20d", 0),
            "breadth_ratio": breadth_ratio,
            "cap_weighted_flow_5d": cap_weighted_flow_5d,
            "leader_strength": leader_strength,
            "leader_rs": leader_rs,
            "score_components": {
                "change_component": round(change_rate * 8.0, 4),
                "core_component": round(core_count * 2.0, 4),
                "breadth_component": round(breadth_score, 4),
                "flow_component": round(flow_score, 4),
                "leader_component": round(leader_score, 4),
            },
            "stock_count": len(group),
            "core_count": core_count
        }
        
        sector_id = f"KRX:{name}"
        
        updates.append({
            "id": sector_id,
            "name": name,
            "score": int(round(score)),
            "change_rate": float(round(change_rate, 6)),
            "metrics": metrics,
            "updated_at": datetime.now().isoformat()
        })

    if updates:
        print(f"💾 {len(updates)}개 섹터 데이터 업서트 중...")
        batch_size = 50
        for i in range(0, len(updates), batch_size):
            batch = updates[i:i+batch_size]
            try:
                supabase.table("sectors").upsert(batch).execute()
            except Exception as e:
                print(f"   ❌ 배치 {i} 업서트 실패: {e}")
    else:
        print("⚠️ 업데이트할 데이터가 없습니다.")
        
    print("✅ 작업 완료.")

if __name__ == "__main__":
    calculate_sector_scores()
