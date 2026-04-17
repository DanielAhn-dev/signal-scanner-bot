import os
import time
import pandas as pd
import numpy as np
from pykrx import stock
from supabase import create_client
from datetime import datetime, timedelta, date

from _price_adjustment import adjust_ohlcv_for_splits

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


def calculate_roc(series, period=14):
    return (series / series.shift(period) - 1.0) * 100.0


def calculate_macd(close, fast=12, slow=26, signal=9):
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line

    cross = None
    if len(macd_line) >= 2 and len(signal_line) >= 2:
        prev_diff = macd_line.iloc[-2] - signal_line.iloc[-2]
        now_diff = macd_line.iloc[-1] - signal_line.iloc[-1]
        if prev_diff <= 0 < now_diff:
            cross = "golden"
        elif prev_diff >= 0 > now_diff:
            cross = "dead"
    return macd_line, signal_line, hist, cross


def calculate_atr_pct(df, period=14):
    high = df["고가"]
    low = df["저가"]
    close = df["종가"]
    prev_close = close.shift(1)

    tr = pd.concat(
        [
            (high - low).abs(),
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr = tr.rolling(window=period, min_periods=period).mean()
    atr14 = atr.iloc[-1] if len(atr) else np.nan
    last_close = close.iloc[-1] if len(close) else np.nan
    atr_pct = (atr14 / last_close * 100.0) if last_close and not pd.isna(atr14) else np.nan
    return atr14, atr_pct


def calculate_avwap_support(close, volume):
    if len(close) < 30:
        return 0.0, "neutral"

    n = len(close)
    anchors = [max(0, int(n * p) - 1) for p in (0.2, 0.5, 0.8)]
    support_hits = 0
    avwaps = []

    for anchor in anchors:
        c = close.iloc[anchor:]
        v = volume.iloc[anchor:]
        denom = v.cumsum().replace(0, np.nan)
        avwap_series = (c * v).cumsum() / denom
        avwap_now = avwap_series.iloc[-1] if len(avwap_series) else np.nan
        if not pd.isna(avwap_now):
            avwaps.append(avwap_now)
            if close.iloc[-1] >= avwap_now:
                support_hits += 1

    if not avwaps:
        return 0.0, "neutral"

    support_pct = (support_hits / len(avwaps)) * 100.0

    regime = "neutral"
    mid_idx = len(avwaps) // 2
    mid_now = avwaps[mid_idx]
    if close.iloc[-1] > mid_now:
        regime = "buyers"
    elif close.iloc[-1] < mid_now:
        regime = "sellers"

    return float(round(support_pct, 2)), regime

def update_technical_indicators():
    print("🔄 기술적 지표(SMA, RSI) 업데이트 시작...")
    asof = date.today().isoformat()
    
    # 1. 관리 대상 종목만 조회 (Core/Extended) - 전체 종목은 너무 오래 걸림
    print("📥 대상 종목 리스트 조회 중...")
    res = supabase.table("stocks").select("code, name").in_("universe_level", ["core", "extended"]).execute()
    targets = res.data or []
    
    if not targets:
        print("⚠️ 업데이트할 대상 종목이 없습니다. (universe_level 설정 필요)")
        return

    target_codes = [row.get("code") for row in targets if row.get("code")]
    existing_scores_map = {}
    try:
        existing_res = (
            supabase.table("scores")
            .select("code, score, total_score, momentum_score, liquidity_score, value_score")
            .eq("asof", asof)
            .in_("code", target_codes)
            .execute()
        )
        for row in existing_res.data or []:
            existing_scores_map[row.get("code")] = row
    except Exception as e:
        print(f"⚠️ 기존 score 조회 실패(기본값 사용): {e}")

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
            df, split_events = adjust_ohlcv_for_splits(df)
            
            if df.empty or len(df) < 20:
                print(f"⚠️ 데이터 부족: {name}({code})")
                continue

            if split_events:
                print(f"↳ {name}({code}) split-adjust: {', '.join(split_events[:2])}")
                
            # 지표 계산
            close = df['종가']
            
            # SMA
            sma20 = close.rolling(window=20).mean().iloc[-1]
            sma50 = close.rolling(window=50).mean().iloc[-1]
            sma200 = close.rolling(window=200).mean().iloc[-1]
            
            # RSI (Wilder's Smoothing 대신 단순 SMA 방식 적용 예시, 정밀도 필요시 수정 가능)
            rsi_series = calculate_rsi(close, 14)
            rsi14 = rsi_series.iloc[-1]

            # ROC
            roc14 = calculate_roc(close, 14).iloc[-1]
            roc21 = calculate_roc(close, 21).iloc[-1]

            # 거래량 비율
            vol20 = df["거래량"].rolling(window=20).mean().iloc[-1]
            vol_ratio = (df["거래량"].iloc[-1] / vol20) if vol20 and not pd.isna(vol20) else np.nan

            # MACD
            _, _, _, macd_cross = calculate_macd(close)

            # ATR
            atr14, atr_pct = calculate_atr_pct(df, 14)

            # AVWAP
            avwap_support, avwap_regime = calculate_avwap_support(close, df["거래량"])
            
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

            factors_payload = {
                "sma20": float(round(sma20, 4)) if not pd.isna(sma20) else None,
                "sma50": float(round(sma50, 4)) if not pd.isna(sma50) else None,
                "sma200": float(round(sma200, 4)) if not pd.isna(sma200) else None,
                "rsi14": float(round(rsi14, 4)) if not pd.isna(rsi14) else None,
                "roc14": float(round(roc14, 4)) if not pd.isna(roc14) else None,
                "roc21": float(round(roc21, 4)) if not pd.isna(roc21) else None,
                "vol_ratio": float(round(vol_ratio, 4)) if not pd.isna(vol_ratio) else None,
                "macd_cross": macd_cross,
                "atr14": float(round(atr14, 4)) if not pd.isna(atr14) else None,
                "atr_pct": float(round(atr_pct, 4)) if not pd.isna(atr_pct) else None,
                "avwap_support": avwap_support,
                "avwap_regime": avwap_regime,
            }

            existing_score = existing_scores_map.get(code) or {}
            score_payload = {
                "code": code,
                "asof": asof,
                "score": float(existing_score.get("score") or 50.0),
                "total_score": int(existing_score.get("total_score") or 50),
                "momentum_score": int(existing_score.get("momentum_score") or 50),
                "liquidity_score": int(existing_score.get("liquidity_score") or 50),
                "value_score": int(existing_score.get("value_score") or 50),
                "factors": factors_payload,
            }
            
            # 개별 업데이트 (배치보다 안전)
            supabase.table("stocks").update(update_data).eq("code", code).execute()
            supabase.table("scores").upsert(score_payload).execute()
            
            print(f"[{i+1}/{len(targets)}] ✅ {name}: Close={current_price}, SMA20={update_data['sma20']}, RSI={update_data['rsi14']}, ROC21={factors_payload['roc21']}")
            success_count += 1
            
            # API 호출 제한 고려 (필요시 sleep)
            # time.sleep(0.1) 
            
        except Exception as e:
            print(f"❌ 실패 {name}({code}): {e}")
            continue

    print(f"🎉 업데이트 완료: 총 {success_count}개 종목 처리됨.")

if __name__ == "__main__":
    update_technical_indicators()
