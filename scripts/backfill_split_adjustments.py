from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from pykrx import stock
from supabase import create_client

from _price_adjustment import adjust_ohlcv_for_splits


ROOT_DIR = Path(__file__).resolve().parents[1]


def load_env_file(filepath=".env"):
    try:
        with open(filepath, "r", encoding="utf-8") as file:
            for line in file:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()
                if key not in os.environ:
                    os.environ[key] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass


load_env_file(ROOT_DIR / ".env.local")
load_env_file(ROOT_DIR / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise SystemExit("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def safe_float(value, default=0.0):
    try:
        result = float(value)
        if np.isnan(result) or np.isinf(result):
            return default
        return result
    except Exception:
        return default


def safe_int(value, default=0):
    try:
        result = float(value)
        if np.isnan(result) or np.isinf(result):
            return default
        return int(result)
    except Exception:
        return default


def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0).fillna(0)
    loss = (-delta.where(delta < 0, 0.0)).fillna(0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def to_iso(yyyymmdd: str) -> str:
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


def flush_upserts(table: str, rows: list[dict], chunk_size: int = 300):
    for idx in range(0, len(rows), chunk_size):
        supabase.table(table).upsert(rows[idx : idx + chunk_size]).execute()


def backfill_code(code: str, start_date: str, end_date: str):
    df = stock.get_market_ohlcv(start_date, end_date, code)
    if df.empty:
        print(f"{code}: OHLCV 데이터가 없습니다.")
        return

    adjusted, events = adjust_ohlcv_for_splits(df)
    if events:
        print(f"{code}: split-adjust {'; '.join(events)}")
    else:
        print(f"{code}: split-adjust 이벤트 없음")

    adjusted = adjusted[adjusted["거래량"].fillna(0) > 0].copy()
    stock_daily_rows: list[dict] = []
    for dt_idx, row in adjusted.iterrows():
        dt_str = dt_idx.strftime("%Y-%m-%d") if hasattr(dt_idx, "strftime") else str(dt_idx)[:10]
        close_val = safe_int(row.get("종가"))
        volume_val = safe_int(row.get("거래량"))
        stock_daily_rows.append(
            {
                "ticker": code,
                "date": dt_str,
                "open": safe_int(row.get("시가")),
                "high": safe_int(row.get("고가")),
                "low": safe_int(row.get("저가")),
                "close": close_val,
                "volume": volume_val,
                "value": safe_float(row.get("거래대금", close_val * volume_val)),
            }
        )

    flush_upserts("stock_daily", stock_daily_rows)

    close = adjusted["종가"].astype(float)
    adjusted = adjusted.copy()
    adjusted["rsi14"] = calculate_rsi(close, 14)
    adjusted["roc14"] = close.pct_change(14) * 100
    adjusted["roc21"] = close.pct_change(21) * 100
    adjusted["sma20"] = close.rolling(20).mean()
    adjusted["sma50"] = close.rolling(50).mean()
    adjusted["sma200"] = close.rolling(200).mean()
    adjusted["slope200"] = adjusted["sma200"].diff(5)

    last = adjusted.iloc[-1]
    trade_date = last.name.strftime("%Y-%m-%d") if hasattr(last.name, "strftime") else str(last.name)[:10]
    daily_indicator_row = {
        "code": code,
        "trade_date": trade_date,
        "close": round(safe_float(last.get("종가")), 4),
        "volume": safe_int(last.get("거래량")),
        "value_traded": round(safe_float(last.get("거래대금")), 4),
        "sma20": round(safe_float(last.get("sma20")), 4) or None,
        "sma50": round(safe_float(last.get("sma50")), 4) or None,
        "sma200": round(safe_float(last.get("sma200")), 4) or None,
        "slope200": round(safe_float(last.get("slope200")), 4) or None,
        "rsi14": round(safe_float(last.get("rsi14")), 4) or None,
        "roc14": round(safe_float(last.get("roc14")), 4) or None,
        "roc21": round(safe_float(last.get("roc21")), 4) or None,
        "updated_at": datetime.now().isoformat(),
    }
    supabase.table("daily_indicators").upsert(daily_indicator_row).execute()

    stock_update = {
        "close": safe_int(last.get("종가")),
        "sma20": round(safe_float(last.get("sma20")), 2) or None,
        "sma50": round(safe_float(last.get("sma50")), 2) or None,
        "rsi14": round(safe_float(last.get("rsi14")), 2) or None,
        "updated_at": datetime.now().isoformat(),
    }
    supabase.table("stocks").update(stock_update).eq("code", code).execute()
    print(f"{code}: stock_daily/daily_indicators/stocks 갱신 완료")


if __name__ == "__main__":
    codes = [arg.strip() for arg in sys.argv[1:] if arg.strip()]
    if not codes:
        raise SystemExit("usage: python scripts/backfill_split_adjustments.py 010120 [005930 ...]")

    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=550)).strftime("%Y%m%d")
    for code in codes:
        backfill_code(code, start, end)