"""
scripts/update_credit_short.py
==============================
장 마감 후 공매도 잔고 + 신용비율 데이터를 수집해 DB에 저장.

  - 공매도: PyKRX (KRX 공식) → stock_credit_short_daily + stocks 테이블
  - 신용비율: Naver Finance HTML 스크래핑 → 동일 테이블 업데이트

사용법:
  python scripts/update_credit_short.py
  python scripts/update_credit_short.py --date 20260509  # 특정 날짜
  python scripts/update_credit_short.py --skip-credit    # 신용비율 스킵
  python scripts/update_credit_short.py --skip-short     # 공매도 스킵
"""
from __future__ import annotations

import os
import sys
import time
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Optional

import requests
from bs4 import BeautifulSoup

try:
    from pykrx import stock as krx_stock
    HAS_PYKRX = True
except ImportError:
    HAS_PYKRX = False
    print("⚠️ pykrx 미설치 — 공매도 수집 불가. pip install pykrx")

from supabase import create_client, Client


# ── 환경 변수 ──────────────────────────────────────────────
def load_env_file(filepath: str = ".env"):
    try:
        with open(filepath) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() not in os.environ:
                    os.environ[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass

load_env_file()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("🚨 SUPABASE_URL / SERVICE_ROLE_KEY 미설정", file=sys.stderr)
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

SKIP_CREDIT = "--skip-credit" in sys.argv
SKIP_SHORT  = "--skip-short"  in sys.argv


# ── 유틸리티 ───────────────────────────────────────────────
def safe_float(x, default: Optional[float] = None) -> Optional[float]:
    try:
        v = float(str(x).replace(",", ""))
        return default if (v != v or v == float("inf") or v == float("-inf")) else v
    except Exception:
        return default

def yyyymmdd_from_date(d: datetime) -> str:
    return d.strftime("%Y%m%d")

def iso_from_yyyymmdd(s: str) -> str:
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"

def get_last_trading_date() -> str:
    """가장 최근 거래일을 YYYYMMDD 형식으로 반환 (삼성전자 기준)"""
    today = datetime.now(ZoneInfo("Asia/Seoul"))
    for delta in range(0, 8):
        d = today - timedelta(days=delta)
        d_str = yyyymmdd_from_date(d)
        if not HAS_PYKRX:
            return d_str
        try:
            df = krx_stock.get_market_ohlcv(d_str, d_str, "005930")
            if not df.empty and df.iloc[0].get("거래량", 0) > 0:
                return d_str
        except Exception:
            continue
    return yyyymmdd_from_date(today)


# ── 공매도 데이터 수집 (PyKRX) ────────────────────────────
def fetch_shorting_all_markets(trading_date: str) -> dict[str, dict]:
    """
    KOSPI + KOSDAQ 전종목 공매도 잔고 조회.
    반환: { code → { short_ratio, short_balance, short_volume } }
    """
    result: dict[str, dict] = {}
    if not HAS_PYKRX:
        return result

    for market in ("KOSPI", "KOSDAQ"):
        try:
            # 시장 전체 공매도 잔고 현황
            df = krx_stock.get_shorting_balance(trading_date, market=market)
            if df is None or df.empty:
                print(f"  ⚠️ {market} 공매도 데이터 없음 (휴장 또는 미발표)")
                continue

            for ticker, row in df.iterrows():
                code = str(ticker).zfill(6)
                # 칼럼명이 버전마다 다를 수 있어 복수 키 시도
                balance = safe_float(
                    row.get("공매도잔고") or row.get("잔고") or row.get("balance")
                )
                ratio = safe_float(
                    row.get("공매도비율") or row.get("잔고비율") or row.get("ratio")
                )
                volume = safe_float(
                    row.get("공매도거래량") or row.get("거래량") or row.get("volume")
                )
                result[code] = {
                    "short_balance": int(balance) if balance is not None else None,
                    "short_ratio":   round(ratio, 4) if ratio is not None else None,
                    "short_volume":  int(volume) if volume is not None else None,
                }
            print(f"  ✅ {market} 공매도 {len(df)}개 종목 수집")
            time.sleep(1)

        except Exception as e:
            print(f"  ⚠️ {market} 공매도 전체 조회 실패: {e}")
            # 전체 조회 실패 시 종목별로 재시도 (핵심 종목만)
            result.update(_fetch_shorting_per_ticker(trading_date, market))

    return result


def _fetch_shorting_per_ticker(trading_date: str, market: str) -> dict[str, dict]:
    """전체 조회 실패 시 대표 종목 핵심 100개만 개별 조회"""
    fallback: dict[str, dict] = {}
    try:
        res = supabase.table("stocks") \
            .select("code") \
            .eq("market", market) \
            .eq("is_active", True) \
            .in_("universe_level", ["core"]) \
            .order("mcap_rank") \
            .limit(100) \
            .execute()
        codes = [r["code"] for r in (res.data or [])]
    except Exception:
        return fallback

    for code in codes:
        try:
            df = krx_stock.get_shorting_balance_by_date(trading_date, trading_date, code)
            if df is None or df.empty:
                continue
            row = df.iloc[0]
            balance = safe_float(row.get("공매도잔고") or row.get("잔고"))
            ratio   = safe_float(row.get("공매도비율") or row.get("잔고비율"))
            volume  = safe_float(row.get("공매도거래량") or row.get("거래량"))
            fallback[code] = {
                "short_balance": int(balance) if balance is not None else None,
                "short_ratio":   round(ratio, 4) if ratio is not None else None,
                "short_volume":  int(volume) if volume is not None else None,
            }
            time.sleep(0.25)
        except Exception:
            continue

    return fallback


# ── 신용비율 수집 (Naver Finance HTML) ───────────────────
def fetch_credit_ratio_naver(code: str) -> Optional[float]:
    """Naver Finance 종목 메인에서 신용비율(%) 파싱"""
    try:
        url = f"https://finance.naver.com/item/main.naver?code={code}"
        resp = requests.get(url, headers={"User-Agent": UA}, timeout=8)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        # 방법 1: th 텍스트로 레이블 탐색
        for th in soup.find_all("th"):
            if th.get_text(strip=True) == "신용비율":
                td = th.find_next_sibling("td")
                if td:
                    text = td.get_text(strip=True)
                    val = safe_float(text.replace("%", "").replace(",", ""))
                    if val is not None:
                        return val

        # 방법 2: 정규식 fallback
        match = re.search(r"신용비율[^0-9]*([0-9]+\.?[0-9]*)", resp.text)
        if match:
            return safe_float(match.group(1))

    except Exception:
        pass
    return None


def fetch_credit_ratios_batch(
    codes: list[str],
    delay: float = 0.5,
) -> dict[str, Optional[float]]:
    """여러 종목 신용비율 순차 수집. 진행 상황 표시 포함."""
    result: dict[str, Optional[float]] = {}
    total = len(codes)
    ok = 0
    for idx, code in enumerate(codes):
        if idx % 50 == 0 and idx > 0:
            print(f"    신용비율 진행: {idx}/{total} (성공: {ok})")
        ratio = fetch_credit_ratio_naver(code)
        result[code] = ratio
        if ratio is not None:
            ok += 1
        time.sleep(delay)
    print(f"    신용비율 완료: {ok}/{total} 성공")
    return result


# ── DB 저장 ───────────────────────────────────────────────
def upsert_daily_records(
    trading_iso: str,
    short_map: dict[str, dict],
    credit_map: dict[str, Optional[float]],
):
    """stock_credit_short_daily 테이블에 upsert"""
    all_codes = set(short_map) | set(credit_map)
    if not all_codes:
        print("  ⚠️ 저장할 데이터 없음")
        return

    rows = []
    for code in all_codes:
        short = short_map.get(code, {})
        rows.append({
            "code":          code,
            "date":          trading_iso,
            "credit_ratio":  credit_map.get(code),
            "short_ratio":   short.get("short_ratio"),
            "short_balance": short.get("short_balance"),
            "short_volume":  short.get("short_volume"),
        })

    BATCH = 500
    saved = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        try:
            supabase.table("stock_credit_short_daily").upsert(chunk).execute()
            saved += len(chunk)
        except Exception as e:
            print(f"  ⚠️ stock_credit_short_daily upsert 에러: {e}")
            # 개별 재시도
            for row in chunk:
                try:
                    supabase.table("stock_credit_short_daily").upsert([row]).execute()
                    saved += 1
                except Exception:
                    pass

    print(f"  ✅ stock_credit_short_daily: {saved}/{len(rows)}개 저장")


def update_stocks_latest(
    short_map: dict[str, dict],
    credit_map: dict[str, Optional[float]],
):
    """stocks 테이블 최신 칼럼 업데이트 (API가 바로 읽음)"""
    all_codes = set(short_map) | set(credit_map)
    updates = []
    for code in all_codes:
        short = short_map.get(code, {})
        update: dict = {"code": code}
        cr = credit_map.get(code)
        if cr is not None:
            update["credit_ratio"] = cr
        sr = short.get("short_ratio")
        if sr is not None:
            update["short_ratio"] = sr
        sb = short.get("short_balance")
        if sb is not None:
            update["short_balance"] = sb
        if len(update) > 1:  # code 외에 실제 업데이트 값이 있을 때만
            updates.append(update)

    if not updates:
        return

    BATCH = 300
    saved = 0
    for i in range(0, len(updates), BATCH):
        chunk = updates[i:i + BATCH]
        try:
            # stocks 테이블은 name NOT NULL 제약 → upsert 대신 개별 update 사용
            for row in chunk:
                code = row.pop("code")
                supabase.table("stocks").update(row).eq("code", code).execute()
                saved += 1
        except Exception as e:
            print(f"  ⚠️ stocks 업데이트 에러: {e}")
    print(f"  ✅ stocks 테이블 최신값: {saved}개 업데이트")


# ── 메인 ──────────────────────────────────────────────────
def main():
    print(f"🚀 공매도/신용비율 ETL 시작: {datetime.now().isoformat()}")

    # 기준 거래일 결정
    if "--date" in sys.argv:
        idx = sys.argv.index("--date")
        trading_date = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else get_last_trading_date()
    else:
        trading_date = get_last_trading_date()

    trading_iso = iso_from_yyyymmdd(trading_date)
    print(f"📅 기준 거래일: {trading_date} ({trading_iso})")

    # ── Step 1: 공매도 수집 ──
    short_map: dict[str, dict] = {}
    if not SKIP_SHORT and HAS_PYKRX:
        print("\n[1/2] 공매도 잔고 수집 (PyKRX)...")
        short_map = fetch_shorting_all_markets(trading_date)
        print(f"  📊 공매도 수집 종목: {len(short_map)}개")
    else:
        print("\n[1/2] 공매도 수집 스킵")

    # ── Step 2: 신용비율 수집 ──
    credit_map: dict[str, Optional[float]] = {}
    if not SKIP_CREDIT:
        print("\n[2/2] 신용비율 수집 (Naver Finance)...")
        # core + extended 활성 종목만 대상 (전종목 대신 유니버스 한정)
        try:
            res = supabase.table("stocks") \
                .select("code") \
                .eq("is_active", True) \
                .in_("universe_level", ["core", "extended"]) \
                .execute()
            target_codes = [r["code"] for r in (res.data or [])]
        except Exception as e:
            print(f"  ❌ 대상 종목 조회 실패: {e}")
            target_codes = []

        if target_codes:
            print(f"  대상: {len(target_codes)}개 종목")
            credit_map = fetch_credit_ratios_batch(target_codes, delay=0.5)
        else:
            print("  ⚠️ 대상 종목 없음")
    else:
        print("\n[2/2] 신용비율 수집 스킵")

    # ── Step 3: DB 저장 ──
    if short_map or credit_map:
        print("\n[DB] 저장 중...")
        upsert_daily_records(trading_iso, short_map, credit_map)
        update_stocks_latest(short_map, credit_map)
    else:
        print("\n⚠️ 저장할 데이터 없음 — 종료")

    print(f"\n🏁 완료: {datetime.now().isoformat()}")


if __name__ == "__main__":
    main()
