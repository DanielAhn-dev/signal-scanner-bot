"""
scripts/daily_batch.py
=====================
매일 장 마감 후 실행 (GitHub Actions: KST 18:00 / UTC 09:00)
  1. 종목 유니버스 & 펀더멘털 갱신  (stocks 테이블)
  2. 당일 OHLCV 시세 수집           (stock_daily 테이블)
  3. 투자자 수급 수집               (investor_daily 테이블)
  4. 섹터 지수 & 등락률 수집        (sector_daily / sectors 테이블)
  5. 기술적 지표 계산               (daily_indicators 테이블)
  6. 섹터 점수 계산                 (sectors 테이블)
  7. 종목 점수 계산                 (scores 테이블)
  8. 오래된 데이터 정리
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
    """오늘 또는 가장 최근 거래일을 YYYYMMDD로 반환"""
    today = date.today()
    today_str = today.strftime("%Y%m%d")

    # 삼성전자로 오늘 데이터 있는지 확인
    try:
        check = stock.get_market_ohlcv(today_str, today_str, "005930")
        if not check.empty and check.iloc[0].get('거래량', 0) > 0:
            return today_str
    except:
        pass

    # 없으면 최근 영업일 역산
    for i in range(1, 8):
        d = today - timedelta(days=i)
        d_str = d.strftime("%Y%m%d")
        try:
            check = stock.get_market_ohlcv(d_str, d_str, "005930")
            if not check.empty and check.iloc[0].get('거래량', 0) > 0:
                return d_str
        except:
            continue

    return today_str

def get_biz_days_ago(date_str: str, n: int) -> str:
    """영업일 n일 전 날짜 반환 (주말 제외)"""
    dt = datetime.strptime(date_str, "%Y%m%d")
    cnt = 0
    while cnt < n:
        dt -= timedelta(days=1)
        if dt.weekday() < 5:
            cnt += 1
    return dt.strftime("%Y%m%d")

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
    v_cumsum = subset['volume'].cumsum()
    if v_cumsum.iloc[-1] == 0:
        return None
    pv = (subset['close'] * subset['volume']).cumsum()
    return float((pv / v_cumsum).iloc[-1])

def retry_call(func, attempts=3, wait=0.5, backoff=2.0):
    last_exc = None
    delay = wait
    for i in range(attempts):
        try:
            return func()
        except Exception as e:
            last_exc = e
            time.sleep(delay)
            delay *= backoff
    raise last_exc


# =============================================
# STEP 1: 종목 유니버스 & 펀더멘털 갱신
# =============================================
def update_universe_and_fundamentals(trading_date: str):
    print(f"\n[1/8] 종목 유니버스 & 펀더멘털 갱신 ({trading_date})...")

    try:
        tickers_kospi = stock.get_market_ticker_list(trading_date, market="KOSPI")
        tickers_kosdaq = stock.get_market_ticker_list(trading_date, market="KOSDAQ")

        if not tickers_kospi:
            print("  ⚠️ 티커 리스트가 비어 있습니다.")
            return

        # 종목명 매핑
        name_map = {}
        for ticker in tickers_kospi + tickers_kosdaq:
            try:
                name_map[ticker] = stock.get_market_ticker_name(ticker)
            except:
                name_map[ticker] = ticker

        # 시가총액 & 펀더멘털
        df_kospi = stock.get_market_cap(trading_date, market="KOSPI")
        time.sleep(0.3)
        df_kosdaq = stock.get_market_cap(trading_date, market="KOSDAQ")
        time.sleep(0.3)

        fund_kospi = stock.get_market_fundamental(trading_date, market="KOSPI")
        time.sleep(0.3)
        fund_kosdaq = stock.get_market_fundamental(trading_date, market="KOSDAQ")

        df_total = pd.concat([df_kospi, df_kosdaq])
        fund_total = pd.concat([fund_kospi, fund_kosdaq])
        df_total = df_total.join(fund_total[['PER', 'PBR']], how='left')
        df_total = df_total.sort_values(by='시가총액', ascending=False)
        df_total['rank'] = range(1, len(df_total) + 1)

        updates = []
        for ticker, row in df_total.iterrows():
            stock_name = name_map.get(ticker, ticker)
            if not stock_name:
                stock_name = ticker

            price = row.get('종가', 0)
            mcap = row.get('시가총액', 0)
            rank = row['rank']
            volume = row.get('거래량', 0)

            per = float(row['PER']) if pd.notnull(row.get('PER')) and row.get('PER', 0) > 0 else None
            pbr = float(row['PBR']) if pd.notnull(row.get('PBR')) and row.get('PBR', 0) > 0 else None

            universe_level = 'tail'
            if price >= 1000:
                if rank <= 200:
                    universe_level = 'core'
                elif rank <= 500:
                    universe_level = 'extended'

            updates.append({
                "code": ticker,
                "name": stock_name,
                "market_cap": safe_int(mcap),
                "mcap_rank": int(rank),
                "universe_level": universe_level,
                "per": per,
                "pbr": pbr,
                "avg_volume_20d": safe_int(volume),
                "close": safe_int(price),
                "is_active": True,
                "updated_at": datetime.now().isoformat(),
            })

            if len(updates) >= 500:
                supabase.table("stocks").upsert(updates).execute()
                updates = []

        if updates:
            supabase.table("stocks").upsert(updates).execute()

        print(f"  ✅ {len(df_total)}개 종목 유니버스 갱신 완료")

    except Exception as e:
        print(f"  ❌ 유니버스 갱신 실패: {e}")
        traceback.print_exc()


# =============================================
# STEP 2: 당일 OHLCV 시세 수집
# =============================================
def fetch_and_save_market_data(trading_date: str) -> bool:
    trading_iso = to_iso(trading_date)
    print(f"\n[2/8] {trading_date} 전 종목 OHLCV 수집...")

    try:
        check = stock.get_market_ohlcv(trading_date, trading_date, "005930")
        if check.empty:
            print("  🔴 휴장일이거나 데이터 없음")
            return False

        df_kospi = stock.get_market_ohlcv_by_ticker(trading_date, market="KOSPI")
        time.sleep(0.3)
        df_kosdaq = stock.get_market_ohlcv_by_ticker(trading_date, market="KOSDAQ")
        df_total = pd.concat([df_kospi, df_kosdaq])

        upsert_rows = []
        for ticker, row in df_total.iterrows():
            if row.get('거래량', 0) == 0:
                continue
            upsert_rows.append({
                "ticker": ticker,
                "date": trading_iso,
                "open": safe_int(row.get("시가")),
                "high": safe_int(row.get("고가")),
                "low": safe_int(row.get("저가")),
                "close": safe_int(row.get("종가")),
                "volume": safe_int(row.get("거래량")),
                "value": safe_float(row.get("거래대금")),
            })

        if upsert_rows:
            print(f"  -> {len(upsert_rows)}개 종목 저장 중...")
            for i in range(0, len(upsert_rows), 1000):
                try:
                    supabase.table("stock_daily").upsert(
                        upsert_rows[i:i+1000]
                    ).execute()
                except Exception as e:
                    print(f"  ⚠️ 배치 에러, 소분할 재시도: {e}")
                    chunk = upsert_rows[i:i+1000]
                    for j in range(0, len(chunk), 100):
                        try:
                            supabase.table("stock_daily").upsert(
                                chunk[j:j+100]
                            ).execute()
                        except:
                            pass

        print(f"  ✅ {len(upsert_rows)}개 종목 시세 저장 완료")
        return True

    except Exception as e:
        print(f"  ❌ 시세 수집 에러: {e}")
        traceback.print_exc()
        return False


# =============================================
# STEP 3: 투자자 수급 수집
# =============================================
def fetch_investor_data(trading_date: str):
    trading_iso = to_iso(trading_date)
    print(f"\n[3/8] 투자자 수급 수집 ({trading_date})...")

    try:
        df_inst = stock.get_market_net_purchases_of_equities_by_ticker(
            trading_date, "ALL", "기관합계"
        )
        time.sleep(0.5)
        df_foreign = stock.get_market_net_purchases_of_equities_by_ticker(
            trading_date, "ALL", "외국인"
        )

        df_merged = pd.merge(
            df_inst, df_foreign,
            left_index=True, right_index=True,
            suffixes=('_기관', '_외국인')
        )

        inv_rows = []
        for ticker, row in df_merged.iterrows():
            i_net = safe_int(row.get('순매수거래대금_기관'))
            f_net = safe_int(row.get('순매수거래대금_외국인'))
            if i_net == 0 and f_net == 0:
                continue
            inv_rows.append({
                "date": trading_iso,
                "ticker": ticker,
                "institution": i_net,
                "foreign": f_net,
            })

        if inv_rows:
            for i in range(0, len(inv_rows), 1000):
                supabase.table("investor_daily").upsert(
                    inv_rows[i:i+1000]
                ).execute()
            print(f"  ✅ {len(inv_rows)}개 수급 데이터 저장 완료")
        else:
            print("  ⚠️ 수급 데이터 없음")

    except Exception as e:
        print(f"  ❌ 수급 수집 실패: {e}")
        traceback.print_exc()


# =============================================
# STEP 4: 섹터 지수 & 수급 집계
# =============================================
def update_sector_data(trading_date: str):
    trading_iso = to_iso(trading_date)
    date_5d_ago = get_biz_days_ago(trading_date, 5)
    date_5d_iso = to_iso(date_5d_ago)

    print(f"\n[4/8] 섹터 지수 & 수급 집계...")

    try:
        # 4-1. 섹터별 등락률 수집 (KRX 지수)
        sector_change_map = {}

        for market in ["KOSPI", "KOSDAQ"]:
            try:
                df = retry_call(
                    lambda m=market: stock.get_index_price_change(
                        trading_date, trading_date, m
                    ),
                    attempts=3, wait=0.5
                )
                if df is not None and not df.empty:
                    for idx_name, row in df.iterrows():
                        name = row.get('지수명', idx_name) if '지수명' in df.columns else idx_name
                        change = safe_float(row.get('등락률', 0))
                        if name and isinstance(name, str):
                            sector_change_map[name.strip()] = change
            except Exception as e:
                print(f"  ⚠️ {market} 지수 수집 실패: {e}")
            time.sleep(0.3)

        print(f"  -> {len(sector_change_map)}개 지수 등락률 수집")

        # 4-2. 섹터별 수급 집계 (investor_daily 에서 최근 5일)
        res_stocks = supabase.table("stocks") \
            .select("code, sector_id") \
            .not_.is_("sector_id", "null").execute()
        stock_sector_map = {
            r["code"]: r["sector_id"]
            for r in (res_stocks.data or [])
        }

        # 최근 5일 수급 데이터
        res_inv = supabase.table("investor_daily") \
            .select("ticker, foreign, institution") \
            .gte("date", date_5d_iso) \
            .lte("date", trading_iso) \
            .execute()

        # 섹터별 합산 (5일 누적) — 매번 새로 계산, 기존값에 더하지 않음!
        sector_flows: Dict[str, Dict[str, int]] = {}
        for row in (res_inv.data or []):
            ticker = row["ticker"]
            sid = stock_sector_map.get(ticker)
            if not sid:
                continue
            if sid not in sector_flows:
                sector_flows[sid] = {"foreign": 0, "institution": 0}
            sector_flows[sid]["foreign"] += safe_int(row.get("foreign"))
            sector_flows[sid]["institution"] += safe_int(row.get("institution"))

        # 4-3. sectors 테이블 업데이트
        res_sectors = supabase.table("sectors") \
            .select("id, name, metrics").execute()

        sector_updates = []
        sector_daily_rows = []

        for sector_row in (res_sectors.data or []):
            sid = sector_row["id"]
            sname = sector_row.get("name", "")
            old_metrics = sector_row.get("metrics") or {}
            krx_index = old_metrics.get("krx_index")

            # 등락률 매칭 (이름 기반)
            change_rate = 0.0
            for cname, crate in sector_change_map.items():
                if sname and (sname in cname or cname in sname):
                    change_rate = crate
                    break

            # 수급 데이터 (REPLACE — 절대 기존값에 누적하지 않음)
            flows = sector_flows.get(sid, {})
            flow_foreign_5d = flows.get("foreign", 0)
            flow_inst_5d = flows.get("institution", 0)

            # KRX 지수 데이터 수집 (sector_daily용)
            if krx_index:
                try:
                    df_idx = stock.get_index_ohlcv(trading_date, trading_date, krx_index)
                    if not df_idx.empty:
                        val = df_idx.iloc[0]
                        close_price = safe_float(val.get("종가"))
                        trade_value = safe_float(val.get("거래대금"))
                        idx_change = safe_float(val.get("등락률"))

                        if close_price > 0:
                            sector_daily_rows.append({
                                "sector_id": sid,
                                "date": trading_iso,
                                "close": close_price,
                                "value": trade_value,
                            })

                        if idx_change != 0:
                            change_rate = idx_change
                except:
                    pass
                time.sleep(0.1)

            # metrics 업데이트 — 수급은 교체(replace), krx_index 등 기존 값 보존
            new_metrics = dict(old_metrics)
            new_metrics["flow_foreign_5d"] = flow_foreign_5d
            new_metrics["flow_inst_5d"] = flow_inst_5d
            new_metrics["stock_count"] = len([
                t for t, s in stock_sector_map.items() if s == sid
            ])

            sector_updates.append({
                "id": sid,
                "name": sname,
                "avg_change_rate": safe_float(change_rate),
                "change_rate": safe_float(change_rate),
                "metrics": new_metrics,
                "updated_at": datetime.now().isoformat(),
            })

        # sector_daily 저장
        if sector_daily_rows:
            supabase.table("sector_daily").upsert(sector_daily_rows).execute()
            print(f"  -> {len(sector_daily_rows)}개 섹터 일별 지수 저장")

        # sectors 테이블 업데이트
        if sector_updates:
            for i in range(0, len(sector_updates), 100):
                supabase.table("sectors").upsert(
                    sector_updates[i:i+100]
                ).execute()
            print(f"  ✅ {len(sector_updates)}개 섹터 수급/등락률 업데이트 완료")

    except Exception as e:
        print(f"  ❌ 섹터 데이터 처리 실패: {e}")
        traceback.print_exc()


# =============================================
# STEP 5: 기술적 지표 계산
# =============================================
def calculate_indicators(trading_date: str):
    trading_iso = to_iso(trading_date)
    print(f"\n[5/8] 기술적 지표 계산...")

    try:
        # 오늘 데이터가 있는 종목
        res = supabase.table("stock_daily") \
            .select("ticker") \
            .eq("date", trading_iso).execute()
        target_tickers = list(set(r['ticker'] for r in (res.data or [])))
    except Exception as e:
        print(f"  ❌ 대상 종목 조회 실패: {e}")
        return

    print(f"  -> 대상 종목: {len(target_tickers)}개")

    chunk_size = 50
    total_success = 0

    for i in range(0, len(target_tickers), chunk_size):
        batch = target_tickers[i:i+chunk_size]
        if i % 200 == 0:
            print(f"  -> 진행: {i}/{len(target_tickers)}")

        upsert_buffer = []
        try:
            # 약 1.5년치 데이터 조회
            from_date = (date.today() - timedelta(days=400)).isoformat()
            h_res = supabase.table("stock_daily") \
                .select("*") \
                .in_("ticker", batch) \
                .gte("date", from_date) \
                .order("date", desc=False).execute()

            h_df = pd.DataFrame(h_res.data)
            if h_df.empty:
                continue
            h_df['date'] = pd.to_datetime(h_df['date'])

            for ticker in batch:
                df = h_df[h_df['ticker'] == ticker].sort_values('date')
                if len(df) < 20:
                    continue

                close = df['close'].astype(float)

                df = df.copy()
                df['rsi14'] = calculate_rsi(close, 14)
                df['roc14'] = close.pct_change(14) * 100
                df['roc21'] = close.pct_change(21) * 100
                df['sma20'] = close.rolling(20).mean()
                df['sma50'] = close.rolling(50).mean()
                df['sma200'] = close.rolling(200).mean()
                df['slope200'] = df['sma200'].diff(5)

                # AVWAP (52주 최저점 기준)
                avwap_val = None
                try:
                    window = min(250, len(df))
                    low_idx = df['low'].astype(float).tail(window).idxmin()
                    idx_loc = df.index.get_loc(low_idx)
                    avwap_val = calculate_avwap(
                        df.assign(
                            close=df['close'].astype(float),
                            volume=df['volume'].astype(float)
                        ),
                        idx_loc
                    )
                except:
                    pass

                last = df.iloc[-1]

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

                upsert_buffer.append({
                    "code": ticker,
                    "trade_date": last['date'].strftime("%Y-%m-%d"),
                    "close": n(last['close']),
                    "volume": n_int(last.get('volume')),
                    "value_traded": n(last.get('value')),
                    "sma20": n(last.get('sma20')),
                    "sma50": n(last.get('sma50')),
                    "sma200": n(last.get('sma200')),
                    "slope200": n(last.get('slope200')),
                    "rsi14": n(last.get('rsi14')),
                    "roc14": n(last.get('roc14')),
                    "roc21": n(last.get('roc21')),
                    "avwap_breakout": n(avwap_val) if avwap_val else None,
                    "updated_at": datetime.now().isoformat(),
                })
                total_success += 1

            if upsert_buffer:
                supabase.table("daily_indicators").upsert(upsert_buffer).execute()

        except Exception as e:
            print(f"  ⚠️ 배치 에러 ({i}~): {e}")
            continue

    print(f"  ✅ {total_success}개 종목 지표 계산 완료")

    # stocks 테이블에도 최신 SMA/RSI 업데이트
    _update_stocks_indicators(trading_date)


def _update_stocks_indicators(trading_date: str):
    """stocks 테이블의 sma20, rsi14 등을 daily_indicators에서 갱신"""
    trading_iso = to_iso(trading_date)
    print("  -> stocks 테이블 지표 동기화...")

    try:
        res = supabase.table("stocks") \
            .select("code") \
            .in_("universe_level", ["core", "extended"]).execute()
        codes = [r["code"] for r in (res.data or [])]

        if not codes:
            return

        for i in range(0, len(codes), 50):
            batch_codes = codes[i:i+50]
            ind_res = supabase.table("daily_indicators") \
                .select("code, close, sma20, sma50, rsi14, roc14") \
                .in_("code", batch_codes) \
                .eq("trade_date", trading_iso).execute()

            for row in (ind_res.data or []):
                update_data = {
                    "close": safe_int(row.get("close")),
                    "sma20": safe_float(row.get("sma20")) if row.get("sma20") else None,
                    "rsi14": safe_float(row.get("rsi14")) if row.get("rsi14") else None,
                    "updated_at": datetime.now().isoformat(),
                }
                try:
                    supabase.table("stocks").update(update_data) \
                        .eq("code", row["code"]).execute()
                except:
                    pass

        print(f"  ✅ stocks 지표 동기화 완료 ({len(codes)}개)")

    except Exception as e:
        print(f"  ⚠️ stocks 지표 동기화 실패: {e}")


# =============================================
# STEP 6: 섹터 점수 계산
# =============================================
def calculate_sector_scores(trading_date: str):
    print(f"\n[6/8] 섹터 점수 계산...")

    try:
        res = supabase.table("sectors") \
            .select("id, name, change_rate, avg_change_rate, metrics").execute()
        sectors = res.data or []

        if not sectors:
            print("  ⚠️ 섹터 데이터 없음")
            return

        # sector_daily 시계열 로드 (최근 60일)
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

            # 수급 점수 (0~30점)
            flow_f = safe_float(metrics.get("flow_foreign_5d", 0))
            flow_i = safe_float(metrics.get("flow_inst_5d", 0))
            flow_total = (flow_f + flow_i) / 1e8  # 억 단위
            flow_score = min(30, max(0, flow_total * 0.5))

            # 일간 모멘텀 점수 (등락률 기반, 0~40점)
            momentum_score = min(40, max(0, (change_rate + 3) * 6.67))

            # 시계열 모멘텀 (0~30점)
            series_score = 15  # 기본값
            if not sd_df.empty:
                sec_series = sd_df[sd_df['sector_id'] == sid].sort_values('date')
                if len(sec_series) >= 5:
                    closes = sec_series['close'].astype(float).tolist()
                    if len(closes) >= 5 and closes[-5] > 0:
                        ret_5d = (closes[-1] - closes[-5]) / closes[-5]
                        series_score = min(30, max(0, (ret_5d + 0.05) * 300))
                    if len(closes) >= 20 and closes[-20] > 0:
                        ret_20d = (closes[-1] - closes[-20]) / closes[-20]
                        if ret_20d > 0:
                            series_score = min(30, series_score + 5)

            total_score = int(round(flow_score + momentum_score + series_score))
            total_score = min(100, max(0, total_score))

            updates.append({
                "id": sid,
                "name": sname,
                "score": total_score,
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
# STEP 7: 종목 점수 계산
# =============================================
def calculate_stock_scores(trading_date: str):
    trading_iso = to_iso(trading_date)
    asof = date.today().isoformat()
    print(f"\n[7/8] 종목 스코어 계산...")

    try:
        # Core/Extended 종목 로드
        res = supabase.table("stocks") \
            .select("code, name, sector_id, universe_level, market_cap, close") \
            .in_("universe_level", ["core", "extended"]).execute()
        all_stocks = res.data or []

        if not all_stocks:
            print("  ⚠️ 대상 종목 없음")
            return

        codes = [s["code"] for s in all_stocks]

        # daily_indicators에서 최신 지표 로드
        indicators_map = {}
        for i in range(0, len(codes), 50):
            batch = codes[i:i+50]
            ind_res = supabase.table("daily_indicators") \
                .select("code, close, rsi14, roc14, roc21, sma20, sma50, sma200, value_traded") \
                .in_("code", batch) \
                .eq("trade_date", trading_iso).execute()
            for row in (ind_res.data or []):
                indicators_map[row["code"]] = row

        # 섹터 점수 로드
        sec_res = supabase.table("sectors") \
            .select("id, score, change_rate").execute()
        sector_score_map = {
            r["id"]: {
                "score": safe_float(r.get("score")),
                "change": safe_float(r.get("change_rate"))
            }
            for r in (sec_res.data or [])
        }

        upserts = []
        for s in all_stocks:
            code = s["code"]
            ind = indicators_map.get(code, {})
            sec_info = sector_score_map.get(s.get("sector_id", ""), {})

            # === 가치 점수 (0~100) ===
            value_score = 50
            if s.get("universe_level") == "core":
                value_score += 15
            elif s.get("universe_level") == "extended":
                value_score += 5

            # === 모멘텀 점수 (0~100) ===
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

            # === 유동성 점수 (0~100) ===
            value_traded = safe_float(ind.get("value_traded"))
            liquidity_score = 30
            if value_traded > 50_000_000_000:
                liquidity_score = 90
            elif value_traded > 10_000_000_000:
                liquidity_score = 70
            elif value_traded > 1_000_000_000:
                liquidity_score = 50

            # === 종합 점수 ===
            w_value, w_mom, w_liq = 0.3, 0.45, 0.25
            total_score = int(round(
                value_score * w_value +
                momentum_score * w_mom +
                liquidity_score * w_liq
            ))
            total_score = min(100, max(0, total_score))

            upserts.append({
                "code": code,
                "asof": asof,
                "score": float(total_score),
                "factors": {
                    "rsi14": round(rsi, 2),
                    "roc14": round(roc14, 2),
                    "roc21": round(roc21, 2),
                    "sector_change": round(sec_change, 2),
                },
                "value_score": int(value_score),
                "momentum_score": int(momentum_score),
                "liquidity_score": int(liquidity_score),
                "total_score": int(total_score),
            })

        # 배치 upsert
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
# STEP 8: 오래된 데이터 정리
# =============================================
def cleanup_old_data():
    print(f"\n[8/8] 오래된 데이터 정리...")
    cutoff = (date.today() - timedelta(days=400)).isoformat()
    try:
        supabase.table("stock_daily").delete().lt("date", cutoff).execute()
        supabase.table("investor_daily").delete().lt("date", cutoff).execute()
        supabase.table("sector_daily").delete().lt("date", cutoff).execute()

        # 30일 이전 완료된 jobs 정리
        jobs_cutoff = (date.today() - timedelta(days=30)).isoformat()
        try:
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
    print(f"   TZ = {os.environ.get('TZ', 'not set')}")

    # 가장 최근 거래일 기준
    trading_date = get_last_trading_date()
    print(f"📅 기준 거래일: {trading_date}")

    # Step 1: 유니버스 갱신
    update_universe_and_fundamentals(trading_date)
    time.sleep(1)

    # Step 2: 시세 수집
    market_ok = fetch_and_save_market_data(trading_date)

    if market_ok:
        time.sleep(1)

        # Step 3: 투자자 수급
        fetch_investor_data(trading_date)
        time.sleep(1)

        # Step 4: 섹터 데이터
        update_sector_data(trading_date)
        time.sleep(1)

        # Step 5: 기술적 지표
        calculate_indicators(trading_date)
        time.sleep(1)

        # Step 6: 섹터 점수
        calculate_sector_scores(trading_date)

        # Step 7: 종목 점수
        calculate_stock_scores(trading_date)

        # Step 8: 정리
        cleanup_old_data()
    else:
        print("⚠️ 시세 수집 실패 - 나머지 단계를 건너뜁니다.")
        print("   (휴장일이거나 장 마감 전일 수 있습니다)")

    print(f"\n🏁 Daily Batch End: {datetime.now().isoformat()}")
