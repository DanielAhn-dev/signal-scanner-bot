#!/usr/bin/env python3
# scripts/generate_stock_scores.py
# 개선판: integer 타입 강제, 업서트 전 페이로드 검사 및 디버그 출력

import os
import time
import traceback
import json
import pandas as pd
from supabase import create_client
from datetime import datetime

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

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (또는 SUPABASE_SERVICE_KEY) 필요")
    exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def safe_float(x, default=0.0):
    try:
        return float(x)
    except:
        return default

def normalize_series_minmax(s: pd.Series):
    s = s.fillna(0).astype(float)
    mn = s.min()
    mx = s.max()
    if mx == mn:
        return pd.Series([0.5]*len(s), index=s.index)
    return (s - mn) / (mx - mn)

def to_int_round(x, default=0):
    try:
        # float-like or numpy -> native int
        return int(round(float(x)))
    except:
        return default

def to_float_native(x, default=0.0):
    try:
        return float(x)
    except:
        return default


def derive_signal(total_score):
    score = to_int_round(total_score, 0)
    if score >= 85:
        return "STRONG_BUY"
    if score >= 70:
        return "BUY"
    if score >= 55:
        return "WATCH"
    if score <= 20:
        return "SELL"
    return "HOLD"

def upsert_with_retry(table, data_batch, attempts=3, wait=1.0):
    last_exc = None
    delay = wait
    for i in range(attempts):
        try:
            resp = supabase.table(table).upsert(data_batch).execute()
            return resp
        except Exception as e:
            last_exc = e
            print(f"   ⚠️ upsert 시도 {i+1}/{attempts} 실패: {e}")
            traceback.print_exc()
            time.sleep(delay)
            delay *= 2
    raise last_exc

def main():
    print("🔄 주식별 scores 생성 시작...")
    asof_date = datetime.now().date().isoformat()  # YYYY-MM-DD

    # 1) stocks 불러오기
    print("📥 stocks 불러오는 중...")
    try:
        res = supabase.table("stocks").select("code, name, market_cap, sector_id, universe_level").limit(10000).execute()
        stocks = pd.DataFrame(getattr(res, "data", res) or [])
    except Exception as e:
        print("❌ stocks 로드 실패:", e)
        traceback.print_exc()
        return

    if stocks.empty:
        print("⚠️ stocks 테이블이 비어있음")
        return

    # 2) sectors 불러오기
    print("📥 sectors 불러오는 중...")
    try:
        sec_res = supabase.table("sectors").select("id, name, change_rate").limit(1000).execute()
        sectors = pd.DataFrame(getattr(sec_res, "data", sec_res) or [])
    except Exception as e:
        print("❌ sectors 로드 실패:", e)
        traceback.print_exc()
        sectors = pd.DataFrame()

    sector_change_map = {}
    if not sectors.empty:
        for _, r in sectors.iterrows():
            key = r.get("name") or r.get("id")
            sector_change_map[key] = safe_float(r.get("change_rate"), 0.0)

    # 3) 전처리
    def extract_sector_name(sid):
        if not sid: return ""
        sid = str(sid)
        return sid.split(":",1)[1] if ":" in sid else sid

    stocks["sector_name"] = stocks["sector_id"].apply(lambda x: extract_sector_name(x) if pd.notna(x) else "")
    stocks["sector_change"] = stocks["sector_name"].map(lambda x: sector_change_map.get(x, 0.0))

    # 정규화 및 점수 계산 (예시)
    sc = stocks["sector_change"].fillna(0).astype(float)
    sc_norm = normalize_series_minmax(sc) * 100.0
    stocks["momentum_score_f"] = sc_norm.round(4)

    stocks["market_cap_num"] = stocks["market_cap"].apply(lambda x: safe_float(x, default=float("nan")))
    mc_series = stocks["market_cap_num"].fillna(stocks["market_cap_num"].median())
    mc_norm = normalize_series_minmax(mc_series)
    stocks["value_score_f"] = ((1.0 - mc_norm) * 100.0).round(4)
    stocks["liquidity_score_f"] = (mc_norm * 100.0).round(4)

    w_value = 0.4; w_mom = 0.4; w_liq = 0.2
    stocks["total_score_f"] = (stocks["value_score_f"] * w_value + stocks["momentum_score_f"] * w_mom + stocks["liquidity_score_f"] * w_liq).round(4)

    # 4) upsert payload 준비 (명시적 타입 변환)
    upserts = []
    for _, r in stocks.iterrows():
        code = r.get("code")
        if not code:
            continue

        # integer 칼럼은 반드시 int 로 보내기 (native Python int)
        value_score_i = to_int_round(r.get("value_score_f"), 0)
        momentum_score_i = to_int_round(r.get("momentum_score_f"), 0)
        liquidity_score_i = to_int_round(r.get("liquidity_score_f"), 0)
        total_score_i = to_int_round(r.get("total_score_f"), 0)

        # score (numeric) : native Python float
        score_numeric = to_float_native(r.get("total_score_f"), 0.0)

        payload = {
            "code": str(code),
            "score": score_numeric,                # numeric
            "signal": derive_signal(total_score_i),
            "factors": {},                         # jsonb NOT NULL
            "asof": asof_date,                     # YYYY-MM-DD (date)
            "value_score": int(value_score_i),     # integer
            "momentum_score": int(momentum_score_i),
            "liquidity_score": int(liquidity_score_i),
            "total_score": int(total_score_i)
        }
        upserts.append(payload)

    if not upserts:
        print("⚠️ upsert 할 데이터가 없음")
        return

    print(f"💾 scores 테이블에 {len(upserts)}개 항목 upsert 시도...")
    batch_size = 200
    inserted = 0
    for i in range(0, len(upserts), batch_size):
        batch = upserts[i:i+batch_size]

        # --- 디버그: 업서트 전 샘플 페이로드 출력 (직렬화된 JSON으로) ---
        try:
            sample_to_show = batch[:3]
            print("   >>> 업서트 샘플 JSON (첫 3개):")
            print(json.dumps(sample_to_show, ensure_ascii=False, indent=2))
        except Exception as e:
            print("   ⚠️ 페이로드 직렬화 실패:", e)

        try:
            resp = upsert_with_retry("scores", batch, attempts=3, wait=1.0)
            inserted += len(batch)
            print(f"   ✅ 배치 업서트 성공 ({i//batch_size + 1}) - 항목 {len(batch)}")
            time.sleep(0.2)
        except Exception as e:
            # 실패한 배치의 첫 항목 타입과 값 출력
            print("   ❌ 배치 업서트 실패. 배치 첫 항목(type/val):")
            first = batch[0] if batch else None
            if first:
                print("   first item:", {k: (type(v).__name__, v) for k,v in first.items()})
                try:
                    print("   first item JSON:", json.dumps(first, ensure_ascii=False))
                except Exception as je:
                    print("   first item JSON 직렬화 실패:", je)
            print("   예외:", e)
            traceback.print_exc()
            # 실패해도 다음 배치로 계속 진행

    print(f"✅ 완료: 약 {inserted}개 항목 upsert 시도 완료. asof={asof_date}")

    # 5) 검증: 상위 10개 출력
    try:
        check = supabase.table("scores").select("code, value_score, momentum_score, liquidity_score, total_score, score, asof").limit(10).execute()
        print("샘플 rows:", getattr(check, "data", check))
    except Exception as e:
        print("검증 쿼리 실패:", e)
        traceback.print_exc()

if __name__ == "__main__":
    main()
