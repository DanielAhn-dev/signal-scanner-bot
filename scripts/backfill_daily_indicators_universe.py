"""
core/extended 유니버스(활성 종목) 기준으로 daily_indicators 과거 구간 백필.
- 입력: stock_daily
- 출력: daily_indicators
- 기본 범위: < 2026-02-09
"""
from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from supabase import Client, create_client


def load_env_file(filepath: str = ".env") -> None:
    p = Path(filepath)
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        k = k.strip()
        if k not in os.environ:
            os.environ[k] = v.strip().strip('"').strip("'")


load_env_file()
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("[ERROR] SUPABASE env missing", file=sys.stderr)
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0).fillna(0)
    loss = (-delta.where(delta < 0, 0.0)).fillna(0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
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


def nf(v):
    try:
        fv = float(v)
        if np.isnan(fv) or np.isinf(fv):
            return None
        return round(fv, 4)
    except Exception:
        return None


def ni(v):
    try:
        fv = float(v)
        if np.isnan(fv) or np.isinf(fv):
            return None
        return int(fv)
    except Exception:
        return None


def get_target_codes() -> list[str]:
    res = (
        supabase.table("stocks")
        .select("code")
        .in_("universe_level", ["core", "extended"])
        .eq("is_active", True)
        .execute()
    )
    codes = sorted({str(r.get("code", "")).strip() for r in (res.data or []) if r.get("code")})
    return [c for c in codes if c]


def fetch_stock_daily_for_code(code: str, cutoff: str) -> pd.DataFrame:
    # 종목별 과거 전체를 로드(페이지네이션)
    rows = []
    start = 0
    step = 1000
    while True:
        part = (
            supabase.table("stock_daily")
            .select("ticker,date,close,volume,value,low")
            .eq("ticker", code)
            .lt("date", cutoff)
            .order("date", desc=False)
            .range(start, start + step - 1)
            .execute()
            .data
            or []
        )
        if not part:
            break
        rows.extend(part)
        start += step
        if len(part) < step:
            break

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df = df.drop_duplicates(subset=["date"], keep="last")
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")
    return df


def build_indicator_rows(code: str, df: pd.DataFrame) -> list[dict]:
    if df.empty or len(df) < 20:
        return []

    close = df["close"].astype(float)
    df = df.copy()
    df["rsi14"] = calculate_rsi(close, 14)
    df["roc14"] = close.pct_change(14) * 100
    df["roc21"] = close.pct_change(21) * 100
    df["sma20"] = close.rolling(20).mean()
    df["sma50"] = close.rolling(50).mean()
    df["sma200"] = close.rolling(200).mean()
    df["slope200"] = df["sma200"].diff(5)

    out: list[dict] = []
    for idx, row in df.iterrows():
        dt = row["date"].strftime("%Y-%m-%d")
        avwap_val = None
        try:
            sub = df.iloc[: df.index.get_loc(idx) + 1]
            window = min(250, len(sub))
            sub = sub.tail(window)
            low_idx = sub["low"].astype(float).idxmin()
            anchor = sub.index.get_loc(low_idx)
            avwap_val = calculate_avwap(
                sub.assign(
                    close=sub["close"].astype(float),
                    volume=sub["volume"].astype(float),
                ),
                anchor,
            )
        except Exception:
            pass

        out.append(
            {
                "code": code,
                "trade_date": dt,
                "close": nf(row.get("close")),
                "volume": ni(row.get("volume")),
                "value_traded": nf(row.get("value")),
                "sma20": nf(row.get("sma20")),
                "sma50": nf(row.get("sma50")),
                "sma200": nf(row.get("sma200")),
                "slope200": nf(row.get("slope200")),
                "rsi14": nf(row.get("rsi14")),
                "roc14": nf(row.get("roc14")),
                "roc21": nf(row.get("roc21")),
                "avwap_breakout": nf(avwap_val),
                "updated_at": datetime.now().isoformat(),
            }
        )
    return out


def upsert_rows(rows: list[dict], batch_size: int = 200) -> int:
    ok = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            supabase.table("daily_indicators").upsert(batch, on_conflict="code,trade_date").execute()
            ok += len(batch)
        except Exception as e:
            print(f"    [WARN] batch upsert fail ({len(batch)}): {str(e)[:120]}")
            for row in batch:
                try:
                    supabase.table("daily_indicators").upsert([row], on_conflict="code,trade_date").execute()
                    ok += 1
                except Exception:
                    pass
    return ok


def main() -> None:
    cutoff = os.environ.get("BACKFILL_CUTOFF", "2026-02-09")
    print("=" * 56)
    print("daily_indicators universe backfill")
    print("=" * 56)
    print(f"cutoff: < {cutoff}")

    codes = get_target_codes()
    print(f"target codes: {len(codes)}")
    if not codes:
        print("no target codes")
        return

    total_rows = 0
    total_upsert = 0
    for i, code in enumerate(codes, start=1):
        df = fetch_stock_daily_for_code(code, cutoff)
        rows = build_indicator_rows(code, df)
        if rows:
            inserted = upsert_rows(rows)
            total_rows += len(rows)
            total_upsert += inserted

        if i % 50 == 0 or i == len(codes):
            print(f"  -> {i}/{len(codes)} codes, rows built={total_rows:,}, upserted={total_upsert:,}")

    print("-" * 56)
    print(f"done. rows built={total_rows:,}, upserted={total_upsert:,}")


if __name__ == "__main__":
    main()
