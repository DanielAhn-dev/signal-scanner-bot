"""
batch_modules/utils.py
=====================
?? ???? ??
"""

import os
import sys
import subprocess
import numpy as np
import pandas as pd
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
from typing import Optional

# KRX 휴장일 (주말 제외). src/lib/krxCalendar.ts의 KRX_HOLIDAYS_BY_YEAR와 같은 목록을 유지한다.
# 2027은 공휴일 기준 추정치 — 거래소 휴장일 공지 후 갱신.
KRX_HOLIDAYS = frozenset([
    "2025-01-01", "2025-01-27", "2025-01-28", "2025-01-29", "2025-01-30", "2025-03-03",
    "2025-05-01", "2025-05-05", "2025-05-06", "2025-06-03", "2025-06-06", "2025-08-15",
    "2025-10-03", "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09", "2025-12-25",
    "2025-12-31",
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02", "2026-05-01",
    "2026-05-05", "2026-05-25", "2026-06-03", "2026-07-17", "2026-08-17", "2026-09-24",
    "2026-09-25", "2026-10-05", "2026-10-09", "2026-12-25", "2026-12-31",
    "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-01", "2027-05-03", "2027-05-05",
    "2027-05-13", "2027-07-19", "2027-08-16", "2027-09-14", "2027-09-15", "2027-09-16",
    "2027-10-04", "2027-10-11", "2027-12-27", "2027-12-31",
])


def is_krx_trading_day(d: date) -> bool:
    """주말·KRX 휴장일이 아니면 True."""
    return d.weekday() < 5 and d.isoformat() not in KRX_HOLIDAYS


def safe_float(x, default=0.0):
    """Safely parse numeric-like values into float.

    Accepts strings with commas or surrounding spaces.
    """
    try:
        if x is None:
            return default
        if isinstance(x, str):
            x = x.strip().replace(",", "")
            if x == "":
                return default
        v = float(x)
        return default if (np.isnan(v) or np.isinf(v)) else v
    except:
        return default


def safe_int(x, default=0):
    """Safely parse numeric-like values into int.

    Accepts strings with commas or surrounding spaces.
    """
    try:
        v = safe_float(x, None)
        if v is None:
            return default
        if np.isnan(v) or np.isinf(v):
            return default
        return int(v)
    except:
        return default


def to_iso(yyyymmdd: str) -> str:
    """YYYYMMDD -> YYYY-MM-DD"""
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


def derive_signal(total_score: int) -> str:
    """?? ?? ??? ??"""
    score = max(0, min(100, safe_int(total_score, 0)))
    if score >= 85:
        return "STRONG_BUY"
    if score >= 70:
        return "BUY"
    if score >= 55:
        return "WATCH"
    if score <= 20:
        return "SELL"
    return "HOLD"


def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """RSI ??"""
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0).fillna(0)
    loss = (-delta.where(delta < 0, 0.0)).fillna(0)
    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def calculate_avwap(df: pd.DataFrame, anchor_idx: int) -> Optional[float]:
    """AVWAP ??"""
    if len(df) == 0 or anchor_idx < 0 or anchor_idx >= len(df):
        return None
    subset = df.iloc[anchor_idx:].copy()
    v_cumsum = subset["volume"].cumsum()
    if v_cumsum.iloc[-1] == 0:
        return None
    pv = (subset["close"] * subset["volume"]).cumsum()
    return float((pv / v_cumsum).iloc[-1])


def get_last_trading_date() -> str:
    """Detect the most recent trading date in KST."""
    from pykrx import stock
    
    today = datetime.now(ZoneInfo("Asia/Seoul")).date()
    test_tickers = ["005930", "035420", "035720", "000660"]
    print("   Detecting latest trading date...", flush=True)
    
    for i in range(0, 60):
        d = today - timedelta(days=i)
        if not is_krx_trading_day(d):
            continue  # 주말·휴장일은 KRX 조회 없이 건너뛴다 (연휴마다 불필요한 요청 → 차단 위험)
        d_str = d.strftime("%Y%m%d")
        
        valid_count = 0
        for ticker in test_tickers:
            try:
                check = stock.get_market_ohlcv(d_str, d_str, ticker)
                # Treat non-empty OHLCV as a valid trading-day signal.
                # Avoid hardcoded localized column names that can break under encoding issues.
                if check is not None and not check.empty:
                    valid_count += 1
            except Exception:
                pass
        
        if valid_count >= 2:
            print(f"   Latest trading date detected: {d_str} ({valid_count}/{len(test_tickers)})", flush=True)
            return d_str
    
    # KRX 조회가 모두 실패해도 "오늘"로 폴백하지 않는다 — 휴장일이면 휴장일 날짜로 점수·신호가 저장된다
    # (2026-05-05·05-25 scores/scan_signal_history). 캘린더상 가장 최근 거래일로 폴백한다.
    fallback = today
    while not is_krx_trading_day(fallback):
        fallback -= timedelta(days=1)
    print(f"   Trading date auto-detect failed, fallback to calendar trading day: {fallback.strftime('%Y%m%d')}", flush=True)
    return fallback.strftime("%Y%m%d")


def run_python_script(script_path: str, args: list[str], label: str) -> bool:
    """Python ???? ??"""
    cmd = [sys.executable, script_path, *args]
    print(f"  -> {label}: {' '.join(cmd)}")
    try:
        env = os.environ.copy()
        env.setdefault("PYTHONIOENCODING", "utf-8")
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        stdout = (result.stdout or "").strip()
        if stdout:
            lines = [line for line in stdout.splitlines() if line.strip()]
            if lines:
                tail = lines[-5:]
                print(f"   {label} output (last {len(tail)} lines):")
                for line in tail:
                    print(f"     {line}")
        return True
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").strip()
        stdout = (e.stdout or "").strip()
        if stdout:
            print(f"  ? stdout: {stdout.splitlines()[-1]}")
        if stderr:
            print(f"  ? stderr: {stderr.splitlines()[-1]}")
        print(f"   {label} failed")
        return False
    except Exception as e:
        print(f"   {label} execution error: {e}")
        return False


def load_env_file(filepath=".env"):
    """?? ?? ??"""
    try:
        with open(filepath, "r", encoding="utf-8-sig") as f:
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


