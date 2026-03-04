"""
scripts/daily_batch.py
=====================
매일 장 마감 후 실행 (GitHub Actions or 수동)
KRX API 제약 대응: 전종목 일괄 API 대신 개별 종목 API 사용

  1. DB 종목 기반 OHLCV 수집          (stock_daily 테이블)
  2. 기술적 지표 계산                  (daily_indicators 테이블)
  3. 섹터 등락률 집계                  (sectors 테이블)
  4. 섹터 점수 계산                    (sectors 테이블)
  5. 종목 점수 계산                    (scores 테이블)
  6. 오래된 데이터 정리
"""
from __future__ import annotations

import os
import sys
import time
import traceback
from datetime import date, datetime, timedelta
from typing import List, Dict, Tuple, Optional

import pandas as pd
import numpy as np
from pykrx import stock
from supabase import create_client, Client

# ===== 환경 변수 설정 =====
def load_env_file(filepath=".env"):
    try:
        with open(filepath, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    key = key.strip()
                    if key not in os.environ:
                        os.environ[key] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass

load_env_file()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("🚨 [Error] SUPABASE_URL or SERVICE_ROLE_KEY missing", file=sys.stderr)
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ===== 유틸리티 =====
def safe_float(x, default=0.0):
    try:
        v = float(x)
        return default if (np.isnan(v) or np.isinf(v)) else v
    except:
        return default

def safe_int(x, default=0):
    try:
        v = float(x)
        if np.isnan(v) or np.isinf(v):
            return default
        return int(v)
    except:
        return default

def get_last_trading_date() -> str:
    """오늘 또는 가장 최근 거래일을 YYYYMMDD로 반환 (삼성전자 기준)"""
    today = date.today()
    for i in range(0, 8):
        d = today - timedelta(days=i)
        d_str = d.strftime("%Y%m%d")
        try:
            check = stock.get_market_ohlcv(d_str, d_str, "005930")
            if not check.empty and check.iloc[0].get("거래량", 0) > 0:
                return d_str
        except:
            continue
    return today.strftime("%Y%m%d")

def to_iso(yyyymmdd: str) -> str:
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"

def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0).fillna(0)
    loss = (-delta.where(delta < 0, 0.0)).fillna(0)
    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def calculate_avwap(df: pd.DataFrame, anchor_idx: int) -> Optional[float]:
    if len(df) == 0 or anchor_idx < 0 or anchor_idx >= len(df):
        return None
    subset = df.iloc[anchor_idx:].copy()
    v_cumsum = subset["volume"].cumsum()
    if v_cumsum.iloc[-1] == 0:
        return None
    pv = (subset["close"] * subset["volume"]).cumsum()
    return float((pv / v_cumsum).iloc[-1])


# =============================================
# STEP 1: DB 종목 기반 OHLCV 수집
# =============================================
def fetch_ohlcv_per_ticker(trading_date: str) -> bool:
    """DB에 등록된 core/extended 종목의 OHLCV를 개별 API로 수집"""
    trading_iso = to_iso(trading_date)
    print(f"\n[1/6] OHLCV 수집 (개별 종목 API, 기준일: {trading_date})...")

    # DB 최근 stock_daily 날짜
    latest_res = supabase.table("stock_daily") \
        .select("date").order("date", desc=True).limit(1).execute()
    latest_date = latest_res.data[0]["date"] if latest_res.data else "2025-01-01"
    print(f"  DB 최신 stock_daily: {latest_date}")

    # 수집 시작일 = DB 최신 + 1일
    from_dt = datetime.strptime(latest_date, "%Y-%m-%d") + timedelta(days=1)
    from_str = from_dt.strftime("%Y%m%d")

    if from_str > trading_date:
        print(f"  ✅ 이미 최신 데이터입니다. 스킵.")
        return True

    print(f"  수집 범위: {from_str} ~ {trading_date}")

    # core + extended 종목
    res = supabase.table("stocks") \
        .select("code, name") \
        .in_("universe_level", ["core", "extended"]) \
        .eq("is_active", True) \
        .execute()
    tickers = [(r["code"], r["name"]) for r in (res.data or [])]

    if not tickers:
        print("  ⚠️ 대상 종목이 없습니다.")
        return False

    print(f"  대상: {len(tickers)}개 종목")

    success = 0
    fail = 0
    upsert_buffer: list = []

    for idx, (code, name) in enumerate(tickers):
        if idx % 50 == 0 and idx > 0:
            print(f"  -> 진행: {idx}/{len(tickers)} (성공: {success}, 실패: {fail})")
            if upsert_buffer:
                _flush_stock_daily(upsert_buffer)
                upsert_buffer = []

        try:
            df = stock.get_market_ohlcv(from_str, trading_date, code)
            if df.empty:
                continue

            for dt_idx, row in df.iterrows():
                vol = safe_int(row.get("거래량", 0))
                if vol == 0:
                    continue
                dt_str = dt_idx.strftime("%Y-%m-%d") if hasattr(dt_idx, "strftime") else str(dt_idx)[:10]
                close_val = safe_int(row.get("종가"))
                upsert_buffer.append({
                    "ticker": code,
                    "date": dt_str,
                    "open": safe_int(row.get("시가")),
                    "high": safe_int(row.get("고가")),
                    "low": safe_int(row.get("저가")),
                    "close": close_val,
                    "volume": vol,
                    "value": safe_float(row.get("거래대금", vol * close_val)),
                })

            success += 1
            time.sleep(0.15)

        except Exception as e:
            fail += 1
            if fail <= 5:
                print(f"    ⚠️ {code} ({name}): {e}")
            time.sleep(0.3)

    if upsert_buffer:
        _flush_stock_daily(upsert_buffer)

    print(f"  ✅ OHLCV 수집 완료: {success}개 성공, {fail}개 실패")

    # stocks.close 동기화
    _update_stocks_close(trading_date)
    return success > 0


def _flush_stock_daily(rows: list):
    for i in range(0, len(rows), 500):
        try:
            supabase.table("stock_daily").upsert(rows[i:i+500]).execute()
        except Exception as e:
            print(f"    ⚠️ stock_daily upsert 에러: {e}")
            chunk = rows[i:i+500]
            for j in range(0, len(chunk), 50):
                try:
                    supabase.table("stock_daily").upsert(chunk[j:j+50]).execute()
                except:
                    pass


def _update_stocks_close(trading_date: str):
    trading_iso = to_iso(trading_date)
    print("  -> stocks 종가 동기화...")
    try:
        # name이 있는 활성 종목만 가져옴 (null name 오류 방지)
        stocks_res = supabase.table("stocks") \
            .select("code, name").eq("is_active", True) \
            .not_.is_("name", "null").execute()
        valid_stocks = {r["code"]: r["name"] for r in (stocks_res.data or [])}

        res = supabase.table("stock_daily") \
            .select("ticker, close") \
            .eq("date", trading_iso).execute()

        updates = [{
            "code": r["ticker"],
            "name": valid_stocks[r["ticker"]],
            "close": safe_int(r["close"]),
            "updated_at": datetime.now().isoformat(),
        } for r in (res.data or []) if r["ticker"] in valid_stocks]

        for i in range(0, len(updates), 200):
            supabase.table("stocks").upsert(updates[i:i+200]).execute()
        print(f"  ✅ {len(updates)}개 종목 종가 동기화")
    except Exception as e:
        print(f"  ⚠️ 종가 동기화 실패: {e}")


# =============================================
# STEP 2: 기술적 지표 계산
# =============================================
def calculate_indicators(trading_date: str):
    trading_iso = to_iso(trading_date)
    print(f"\n[2/6] 기술적 지표 계산...")

    try:
        res = supabase.table("stock_daily") \
            .select("ticker").eq("date", trading_iso).execute()
        target_tickers = list(set(r["ticker"] for r in (res.data or [])))
    except Exception as e:
        print(f"  ❌ 대상 종목 조회 실패: {e}")
        return

    if not target_tickers:
        print("  ⚠️ 오늘 데이터가 있는 종목이 없습니다.")
        return

    print(f"  -> 대상 종목: {len(target_tickers)}개")

    total_success = 0
    total_fail = 0
    upsert_buffer: list = []
    from_date = (date.today() - timedelta(days=400)).isoformat()

    def n(v):
        try:
            fv = float(v)
            return None if (pd.isna(fv) or np.isinf(fv)) else round(fv, 4)
        except:
            return None

    def n_int(v):
        try:
            fv = float(v)
            return None if (pd.isna(fv) or np.isinf(fv)) else int(fv)
        except:
            return None

    for idx, ticker in enumerate(target_tickers):
        if idx % 100 == 0:
            print(f"  -> 진행: {idx}/{len(target_tickers)}")
            # flush buffer periodically
            if upsert_buffer:
                try:
                    supabase.table("daily_indicators").upsert(upsert_buffer).execute()
                except Exception as e:
                    print(f"    ⚠️ upsert 에러: {e}")
                upsert_buffer = []

        try:
            # 종목별로 개별 조회 (PostgREST 1000행 제한 회피)
            h_res = supabase.table("stock_daily") \
                .select("*") \
                .eq("ticker", ticker) \
                .gte("date", from_date) \
                .order("date", desc=False) \
                .limit(500).execute()

            if not h_res.data or len(h_res.data) < 20:
                continue

            df = pd.DataFrame(h_res.data)
            df["date"] = pd.to_datetime(df["date"])
            df = df.sort_values("date")

            close = df["close"].astype(float)
            df = df.copy()
            df["rsi14"] = calculate_rsi(close, 14)
            df["roc14"] = close.pct_change(14) * 100
            df["roc21"] = close.pct_change(21) * 100
            df["sma20"] = close.rolling(20).mean()
            df["sma50"] = close.rolling(50).mean()
            df["sma200"] = close.rolling(200).mean()
            df["slope200"] = df["sma200"].diff(5)

            avwap_val = None
            try:
                window = min(250, len(df))
                low_idx = df["low"].astype(float).tail(window).idxmin()
                idx_loc = df.index.get_loc(low_idx)
                avwap_val = calculate_avwap(
                    df.assign(close=df["close"].astype(float), volume=df["volume"].astype(float)),
                    idx_loc,
                )
            except:
                pass

            last = df.iloc[-1]
            last_date_str = last["date"].strftime("%Y-%m-%d")

            upsert_buffer.append({
                "code": ticker,
                "trade_date": last_date_str,
                "close": n(last["close"]),
                "volume": n_int(last.get("volume")),
                "value_traded": n(last.get("value")),
                "sma20": n(last.get("sma20")),
                "sma50": n(last.get("sma50")),
                "sma200": n(last.get("sma200")),
                "slope200": n(last.get("slope200")),
                "rsi14": n(last.get("rsi14")),
                "roc14": n(last.get("roc14")),
                "roc21": n(last.get("roc21")),
                "avwap_breakout": n(avwap_val) if avwap_val else None,
                "updated_at": datetime.now().isoformat(),
            })
            total_success += 1

        except Exception as e:
            total_fail += 1
            if total_fail <= 5:
                print(f"    ⚠️ {ticker}: {e}")
            continue

    # flush remaining
    if upsert_buffer:
        try:
            supabase.table("daily_indicators").upsert(upsert_buffer).execute()
        except Exception as e:
            print(f"    ⚠️ 최종 upsert 에러: {e}")

    print(f"  ✅ {total_success}개 종목 지표 계산 완료 (실패: {total_fail}개)")
    _sync_stocks_indicators(trading_date)


def _sync_stocks_indicators(trading_date: str):
    trading_iso = to_iso(trading_date)
    print("  -> stocks 테이블 지표 동기화...")
    try:
        res = supabase.table("stocks") \
            .select("code, name").in_("universe_level", ["core", "extended"]).execute()
        # name이 있는 종목만 (null name 오류 방지)
        valid_stocks = {r["code"]: r["name"] for r in (res.data or []) if r.get("name")}
        codes = list(valid_stocks.keys())
        if not codes:
            return
        for i in range(0, len(codes), 50):
            batch_codes = codes[i:i+50]
            ind_res = supabase.table("daily_indicators") \
                .select("code, close, sma20, sma50, rsi14, roc14") \
                .in_("code", batch_codes) \
                .eq("trade_date", trading_iso).execute()
            updates = []
            for row in (ind_res.data or []):
                code = row["code"]
                if code not in valid_stocks:
                    continue
                updates.append({
                    "code": code,
                    "name": valid_stocks[code],  # name 포함하여 null 오류 방지
                    "close": safe_int(row.get("close")),
                    "sma20": safe_float(row.get("sma20")) if row.get("sma20") else None,
                    "rsi14": safe_float(row.get("rsi14")) if row.get("rsi14") else None,
                    "updated_at": datetime.now().isoformat(),
                })
            if updates:
                supabase.table("stocks").upsert(updates).execute()
        print(f"  ✅ stocks 지표 동기화 완료 ({len(codes)}개)")
    except Exception as e:
        print(f"  ⚠️ stocks 지표 동기화 실패: {e}")


# =============================================
# STEP 3: 섹터 등락률 집계 (주식 데이터 기반)
# =============================================
def update_sector_data(trading_date: str):
    trading_iso = to_iso(trading_date)
    print(f"\n[3/6] 섹터 등락률 집계 (구성종목 기반)...")

    try:
        res_stocks = supabase.table("stocks") \
            .select("code, sector_id, close") \
            .not_.is_("sector_id", "null") \
            .eq("is_active", True).execute()
        stock_sector_map = {r["code"]: r["sector_id"] for r in (res_stocks.data or [])}

        # 최근 2일 stock_daily (날짜 내림차순)
        dates_res = supabase.table("stock_daily") \
            .select("date") \
            .lte("date", trading_iso) \
            .order("date", desc=True).limit(1).execute()
        if not dates_res.data:
            print("  ⚠️ stock_daily 데이터 없음")
            return

        latest = dates_res.data[0]["date"]
        # latest 기준으로 이전 날짜 찾기
        prev_res = supabase.table("stock_daily") \
            .select("date") \
            .lt("date", latest) \
            .order("date", desc=True).limit(1).execute()
        prev_date = prev_res.data[0]["date"] if prev_res.data else None

        if not prev_date:
            print("  ⚠️ 이전 영업일 데이터 없음 — 등락률 계산 불가")
            return

        print(f"  등락률: {prev_date} → {latest}")

        # 두 날짜의 종가 로드
        today_res = supabase.table("stock_daily") \
            .select("ticker, close").eq("date", latest).execute()
        prev_day_res = supabase.table("stock_daily") \
            .select("ticker, close").eq("date", prev_date).execute()

        today_map = {r["ticker"]: safe_float(r["close"]) for r in (today_res.data or [])}
        prev_map = {r["ticker"]: safe_float(r["close"]) for r in (prev_day_res.data or [])}

        # 섹터별 평균 등락률
        sector_changes: Dict[str, List[float]] = {}
        for ticker in today_map:
            sid = stock_sector_map.get(ticker)
            if not sid or ticker not in prev_map:
                continue
            t_price, p_price = today_map[ticker], prev_map[ticker]
            if p_price > 0:
                change = (t_price - p_price) / p_price * 100
                sector_changes.setdefault(sid, []).append(change)

        # sectors 업데이트
        res_sectors = supabase.table("sectors") \
            .select("id, name, metrics").execute()

        sector_updates = []
        for sec in (res_sectors.data or []):
            sid = sec["id"]
            sname = sec.get("name", "")
            old_metrics = sec.get("metrics") or {}
            changes = sector_changes.get(sid, [])
            avg_change = sum(changes) / len(changes) if changes else 0.0

            new_metrics = dict(old_metrics)
            new_metrics["stock_count"] = len([t for t, s in stock_sector_map.items() if s == sid])

            sector_updates.append({
                "id": sid,
                "name": sname,
                "avg_change_rate": round(avg_change, 4),
                "change_rate": round(avg_change, 4),
                "metrics": new_metrics,
                "updated_at": datetime.now().isoformat(),
            })

        if sector_updates:
            for i in range(0, len(sector_updates), 100):
                supabase.table("sectors").upsert(sector_updates[i:i+100]).execute()
            print(f"  ✅ {len(sector_updates)}개 섹터 등락률 업데이트")

    except Exception as e:
        print(f"  ❌ 섹터 데이터 처리 실패: {e}")
        traceback.print_exc()


# =============================================
# STEP 3.5: sector_daily 시계열 생성 (구성종목 기반)
# =============================================
def populate_sector_daily():
    """
    sector_daily 테이블에 시계열 데이터를 구성종목 기반으로 생성.
    - 이전 sector_daily의 마지막 close를 기준으로 등락률을 적용하여 인덱스 계산
    - sector_daily가 비어있는 경우 기준값 1000으로 시작
    """
    print(f"\n[3.5/6] sector_daily 시계열 생성...")

    try:
        # 1. 섹터별 마지막 sector_daily 조회
        existing_res = supabase.table("sector_daily") \
            .select("sector_id, date, close, value") \
            .order("date", desc=True).limit(1000).execute()

        last_known: Dict[str, dict] = {}
        for r in (existing_res.data or []):
            sid = r["sector_id"]
            if sid not in last_known:
                last_known[sid] = {"date": r["date"], "close": safe_float(r["close"], 1000), "value": safe_float(r.get("value"), 0)}

        latest_sector_date = max((v["date"] for v in last_known.values()), default="2025-01-01")
        print(f"  기존 sector_daily 최신: {latest_sector_date}")

        # 2. 종목-섹터 매핑
        stocks_res = supabase.table("stocks") \
            .select("code, sector_id") \
            .not_.is_("sector_id", "null") \
            .eq("is_active", True).execute()
        stock_sector = {r["code"]: r["sector_id"] for r in (stocks_res.data or [])}
        all_sector_ids = set(stock_sector.values())

        # 3. stock_daily에서 latest_sector_date 이후 고유 거래일 조회
        #    (전체 조회 시 limit 문제 → 기준종목(삼성전자)으로 날짜만 추출)
        ref_ticker = "005930"
        dates_res = supabase.table("stock_daily") \
            .select("date") \
            .eq("ticker", ref_ticker) \
            .gt("date", latest_sector_date) \
            .order("date", desc=False) \
            .limit(500).execute()

        unique_dates = sorted(set(r["date"] for r in (dates_res.data or [])))
        if not unique_dates:
            print("  ⚠️ 새로운 stock_daily 날짜 없음 — 스킵")
            return

        print(f"  처리할 날짜: {len(unique_dates)}개 ({unique_dates[0]} ~ {unique_dates[-1]})")

        # 이전 날짜 데이터 (등락률 계산용)
        prev_date_data: Dict[str, dict] = {}
        # 최초에는 latest_sector_date 당일 데이터를 이전 값으로 사용
        if latest_sector_date > "2025-01-01":
            prev_res = supabase.table("stock_daily") \
                .select("ticker, close") \
                .eq("date", latest_sector_date) \
                .limit(2000).execute()
            for r in (prev_res.data or []):
                prev_date_data[r["ticker"]] = {"close": safe_float(r["close"])}

        upsert_buffer: list = []

        for di, dt in enumerate(unique_dates):
            # 해당 날짜의 stock_daily 조회
            day_res = supabase.table("stock_daily") \
                .select("ticker, close, value, volume") \
                .eq("date", dt) \
                .limit(2000).execute()
            day_data = {r["ticker"]: {"close": safe_float(r["close"]), "value": safe_float(r.get("value", 0))} for r in (day_res.data or [])}

            if not day_data:
                continue

            # 섹터별 등락률 및 거래대금 집계
            sector_agg: Dict[str, Dict] = {}  # sector_id -> {changes: [], values: []}
            for ticker, td in day_data.items():
                sid = stock_sector.get(ticker)
                if not sid:
                    continue
                if sid not in sector_agg:
                    sector_agg[sid] = {"changes": [], "values": []}

                prev = prev_date_data.get(ticker, {}).get("close", 0)
                cur = td["close"]
                if prev > 0 and cur > 0:
                    change_pct = (cur - prev) / prev
                    sector_agg[sid]["changes"].append(change_pct)
                sector_agg[sid]["values"].append(td["value"])

            # 섹터별 새 close 계산
            for sid in all_sector_ids:
                agg = sector_agg.get(sid)
                if not agg or not agg["changes"]:
                    continue

                avg_change = sum(agg["changes"]) / len(agg["changes"])
                total_value = sum(agg["values"])

                # 이전 close에서 이어서 계산
                prev_close = last_known.get(sid, {}).get("close", 1000.0)
                new_close = round(prev_close * (1 + avg_change), 2)

                upsert_buffer.append({
                    "sector_id": sid,
                    "date": dt,
                    "close": new_close,
                    "value": total_value,
                    "updated_at": datetime.now().isoformat(),
                })

                # 다음 날짜 계산을 위해 업데이트
                last_known[sid] = {"date": dt, "close": new_close, "value": total_value}

            # 다음 날 등락률 계산을 위해 이전 날짜 데이터 업데이트
            prev_date_data = {t: {"close": d["close"]} for t, d in day_data.items()}

            # 주기적으로 flush
            if len(upsert_buffer) >= 500:
                try:
                    supabase.table("sector_daily").upsert(upsert_buffer).execute()
                except Exception as e:
                    print(f"    ⚠️ sector_daily upsert 에러: {e}")
                upsert_buffer = []

            if (di + 1) % 20 == 0:
                print(f"  -> 진행: {di + 1}/{len(unique_dates)}")

        # 일괄 upsert
        if upsert_buffer:
            try:
                supabase.table("sector_daily").upsert(upsert_buffer).execute()
            except Exception as e:
                print(f"    ⚠️ sector_daily upsert 에러: {e}")
        print(f"  ✅ sector_daily 시계열 생성 완료 ({len(unique_dates)}일)")

    except Exception as e:
        print(f"  ❌ sector_daily 생성 실패: {e}")
        traceback.print_exc()


# =============================================
# STEP 4: 섹터 점수 계산
# =============================================
def calculate_sector_scores():
    print(f"\n[4/6] 섹터 점수 계산...")
    try:
        res = supabase.table("sectors") \
            .select("id, name, change_rate, avg_change_rate, metrics").execute()
        sectors = res.data or []
        if not sectors:
            print("  ⚠️ 섹터 데이터 없음")
            return

        from_date = (date.today() - timedelta(days=90)).isoformat()
        sd_res = supabase.table("sector_daily") \
            .select("sector_id, date, close, value") \
            .gte("date", from_date) \
            .order("date", desc=False).execute()
        sd_df = pd.DataFrame(sd_res.data or [])

        updates = []
        for sec in sectors:
            sid = sec["id"]
            sname = sec.get("name", "")
            metrics = sec.get("metrics") or {}
            change_rate = safe_float(sec.get("change_rate"))

            flow_f = safe_float(metrics.get("flow_foreign_5d", 0))
            flow_i = safe_float(metrics.get("flow_inst_5d", 0))
            flow_total = (flow_f + flow_i) / 1e8
            flow_score = min(30, max(0, flow_total * 0.5))

            momentum_score = min(40, max(0, (change_rate + 3) * 6.67))

            series_score = 15
            if not sd_df.empty:
                sec_series = sd_df[sd_df["sector_id"] == sid].sort_values("date")
                if len(sec_series) >= 5:
                    closes = sec_series["close"].astype(float).tolist()
                    if len(closes) >= 5 and closes[-5] > 0:
                        ret_5d = (closes[-1] - closes[-5]) / closes[-5]
                        series_score = min(30, max(0, (ret_5d + 0.05) * 300))
                    if len(closes) >= 20 and closes[-20] > 0:
                        ret_20d = (closes[-1] - closes[-20]) / closes[-20]
                        if ret_20d > 0:
                            series_score = min(30, series_score + 5)

            total_score = min(100, max(0, int(round(flow_score + momentum_score + series_score))))
            updates.append({
                "id": sid, "name": sname, "score": total_score,
                "updated_at": datetime.now().isoformat(),
            })

        if updates:
            for i in range(0, len(updates), 100):
                supabase.table("sectors").upsert(updates[i:i+100]).execute()
            print(f"  ✅ {len(updates)}개 섹터 점수 업데이트 완료")
    except Exception as e:
        print(f"  ❌ 섹터 점수 계산 실패: {e}")
        traceback.print_exc()


# =============================================
# STEP 5: 종목 점수 계산
# =============================================
def calculate_stock_scores(trading_date: str):
    trading_iso = to_iso(trading_date)
    asof = date.today().isoformat()
    print(f"\n[5/6] 종목 스코어 계산...")

    try:
        res = supabase.table("stocks") \
            .select("code, name, sector_id, universe_level, market_cap, close") \
            .in_("universe_level", ["core", "extended"]).execute()
        all_stocks = res.data or []
        if not all_stocks:
            print("  ⚠️ 대상 종목 없음")
            return

        codes = [s["code"] for s in all_stocks]
        indicators_map: dict = {}
        for i in range(0, len(codes), 50):
            batch = codes[i:i+50]
            ind_res = supabase.table("daily_indicators") \
                .select("code, close, rsi14, roc14, roc21, sma20, sma50, sma200, value_traded") \
                .in_("code", batch) \
                .eq("trade_date", trading_iso).execute()
            for row in (ind_res.data or []):
                indicators_map[row["code"]] = row

        print(f"  -> {len(indicators_map)}개 종목 지표 로드됨")

        sec_res = supabase.table("sectors").select("id, score, change_rate").execute()
        sector_score_map = {
            r["id"]: {"score": safe_float(r.get("score")), "change": safe_float(r.get("change_rate"))}
            for r in (sec_res.data or [])
        }

        upserts = []
        for s in all_stocks:
            code = s["code"]
            ind = indicators_map.get(code, {})
            sec_info = sector_score_map.get(s.get("sector_id", ""), {})

            value_score = 50
            if s.get("universe_level") == "core":
                value_score += 15
            elif s.get("universe_level") == "extended":
                value_score += 5

            rsi = safe_float(ind.get("rsi14"), 50)
            roc14 = safe_float(ind.get("roc14"))
            roc21 = safe_float(ind.get("roc21"))
            close_price = safe_float(ind.get("close"), safe_float(s.get("close")))
            sma20 = safe_float(ind.get("sma20"))
            sma50 = safe_float(ind.get("sma50"))
            sma200 = safe_float(ind.get("sma200"))

            momentum_score = 30
            if 45 <= rsi <= 65:
                momentum_score += 20
            elif 35 <= rsi <= 70:
                momentum_score += 10
            if roc14 > 0:
                momentum_score += min(15, roc14 * 3)
            if roc21 > 0:
                momentum_score += min(10, roc21 * 2)
            if close_price > 0 and sma20 > 0 and sma50 > 0:
                if close_price > sma20 > sma50:
                    momentum_score += 15
                elif close_price > sma20:
                    momentum_score += 8
            sec_change = sec_info.get("change", 0)
            if sec_change > 0:
                momentum_score += min(10, sec_change * 3)
            momentum_score = min(100, max(0, int(momentum_score)))

            value_traded = safe_float(ind.get("value_traded"))
            liquidity_score = 30
            if value_traded > 50_000_000_000:
                liquidity_score = 90
            elif value_traded > 10_000_000_000:
                liquidity_score = 70
            elif value_traded > 1_000_000_000:
                liquidity_score = 50

            total_score = min(100, max(0, int(round(
                value_score * 0.3 + momentum_score * 0.45 + liquidity_score * 0.25
            ))))

            upserts.append({
                "code": code, "asof": asof,
                "score": float(total_score),
                "factors": {
                    "rsi14": round(rsi, 2), "roc14": round(roc14, 2),
                    "roc21": round(roc21, 2), "sector_change": round(sec_change, 2),
                },
                "value_score": int(value_score),
                "momentum_score": int(momentum_score),
                "liquidity_score": int(liquidity_score),
                "total_score": int(total_score),
            })

        if upserts:
            print(f"  -> {len(upserts)}개 종목 점수 저장 중...")
            for i in range(0, len(upserts), 200):
                batch = upserts[i:i+200]
                try:
                    supabase.table("scores").upsert(batch).execute()
                except Exception as e:
                    print(f"  ⚠️ 점수 배치 실패: {e}")
                    for j in range(0, len(batch), 50):
                        try:
                            supabase.table("scores").upsert(batch[j:j+50]).execute()
                        except:
                            pass
            print(f"  ✅ {len(upserts)}개 종목 점수 저장 완료")
    except Exception as e:
        print(f"  ❌ 종목 점수 계산 실패: {e}")
        traceback.print_exc()


# =============================================
# STEP 6: 오래된 데이터 정리
# =============================================
def cleanup_old_data():
    print(f"\n[6/6] 오래된 데이터 정리...")
    cutoff = (date.today() - timedelta(days=400)).isoformat()
    try:
        supabase.table("stock_daily").delete().lt("date", cutoff).execute()
        supabase.table("investor_daily").delete().lt("date", cutoff).execute()
        supabase.table("sector_daily").delete().lt("date", cutoff).execute()
        try:
            jobs_cutoff = (date.today() - timedelta(days=30)).isoformat()
            supabase.table("jobs").delete() \
                .in_("status", ["done", "failed"]) \
                .lt("created_at", jobs_cutoff).execute()
        except:
            pass
        print("  ✅ 정리 완료")
    except Exception as e:
        print(f"  ⚠️ 정리 실패 (무시 가능): {e}")


# =============================================
# MAIN
# =============================================
if __name__ == "__main__":
    print(f"🚀 Daily Batch Start: {datetime.now().isoformat()}")
    print(f"   ⚠️ KRX batch API 미작동 → 개별 종목 API 모드")

    # --skip-ohlcv 플래그로 OHLCV 수집 스킵 가능
    skip_ohlcv = "--skip-ohlcv" in sys.argv

    trading_date = get_last_trading_date()
    print(f"📅 기준 거래일: {trading_date}")

    if skip_ohlcv:
        print("\n[1/6] OHLCV 수집 스킵 (--skip-ohlcv)")
        market_ok = True
    else:
        # Step 1: OHLCV 수집
        market_ok = fetch_ohlcv_per_ticker(trading_date)

    if market_ok:
        time.sleep(1)
        calculate_indicators(trading_date)      # Step 2
        time.sleep(1)
        update_sector_data(trading_date)         # Step 3
        populate_sector_daily()                  # Step 3.5
        time.sleep(1)
        calculate_sector_scores()                # Step 4
        calculate_stock_scores(trading_date)     # Step 5
        cleanup_old_data()                       # Step 6
    else:
        print("⚠️ OHLCV 수집 실패 — 나머지 단계 스킵")

    print(f"\n🏁 Daily Batch End: {datetime.now().isoformat()}")
