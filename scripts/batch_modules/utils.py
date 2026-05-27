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


def safe_float(x, default=0.0):
    """??? float ??"""
    try:
        v = float(x)
        return default if (np.isnan(v) or np.isinf(v)) else v
    except:
        return default


def safe_int(x, default=0):
    """??? int ??"""
    try:
        v = float(x)
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
    
    print(f"   Trading date auto-detect failed, fallback to today: {today.strftime('%Y%m%d')}", flush=True)
    return today.strftime("%Y%m%d")


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
                print(f"   {label} output: {lines[-1]}")
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


