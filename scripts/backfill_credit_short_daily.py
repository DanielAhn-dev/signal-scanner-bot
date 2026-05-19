"""
scripts/backfill_credit_short_daily.py
=====================================
공매도 데이터 과거 백필 스크립트
- KRX MDC_OUT API (인증 불필요 공개 엔드포인트) 사용
- ISIN 매핑: KRX finder_stkisu API
- 공매도 거래 비율: MDCSTAT30102_OUT (일별 공매도 수량/비율)
- 공매도 잔고 비율: MDCSTAT30502_OUT (공매도 순보유잔고)
- stock_credit_short_daily 테이블에 저장
- 신용비율(credit_ratio)은 수집 불가(Naver/KRX 모두 공개 API 없음) → NULL 저장

사용법:
  python scripts/backfill_credit_short_daily.py --start 20260101 --end 20260519
  python scripts/backfill_credit_short_daily.py --start 20260515 --end 20260519 --dry-run
"""
from __future__ import annotations

import os
import sys
import time
import argparse
from datetime import datetime, timedelta
from typing import Optional

import requests
from supabase import create_client, Client
from pykrx import stock as pykrx_stock


# ===== 환경 변수 설정 =====
def load_env_file(filepath: str = ".env") -> None:
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
    print("ERROR: SUPABASE_URL or SERVICE_ROLE_KEY missing", file=sys.stderr)
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# KRX API 기본 설정
KRX_API_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
KRX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
KRX_HEADERS = {
    "User-Agent": KRX_UA,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://data.krx.co.kr/",
}


def to_iso(yyyymmdd: str) -> str:
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


def get_krx_session() -> requests.Session:
    """KRX MDC_OUT API 접근용 세션 생성"""
    sess = requests.Session()
    sess.headers.update(KRX_HEADERS)
    try:
        sess.get("https://data.krx.co.kr/", timeout=10)
    except Exception:
        pass
    return sess


def load_isin_map(sess: requests.Session) -> dict:
    """
    KRX finder_stkisu API로 전체 종목 코드 to ISIN 매핑.
    Returns: {"005930": "KR7005930003", "035720": "KR7035720002", ...}
    """
    try:
        r = sess.post(
            KRX_API_URL,
            data={
                "bld": "dbms/comm/finder/finder_stkisu",
                "mktsel": "ALL",
                "typeNo": "0",
                "pagePath": "/contents/MDC/STAT/srt/MDCSTAT300.cmd",
                "codeNm": "",
            },
            timeout=30,
        )
        r.raise_for_status()
        block = r.json().get("block1", [])
        return {item["short_code"]: item["full_code"] for item in block}
    except Exception as e:
        print(f"  ISIN 매핑 조회 실패: {e}")
        return {}


def get_trading_dates(start_date: str, end_date: str) -> list:
    """pykrx 기준으로 실제 거래일만 반환 (YYYYMMDD 리스트)"""
    start_dt = datetime.strptime(start_date, "%Y%m%d").date()
    end_dt = datetime.strptime(end_date, "%Y%m%d").date()
    trading_dates = []
    current = start_dt
    while current <= end_dt:
        yyyymmdd = current.strftime("%Y%m%d")
        try:
            df = pykrx_stock.get_market_ohlcv(yyyymmdd, yyyymmdd, "005930")
            if not df.empty and int(df.iloc[0].get("거래량", 0)) > 0:
                trading_dates.append(yyyymmdd)
        except Exception:
            pass
        current += timedelta(days=1)
    return trading_dates


def load_target_codes() -> list:
    """stocks 테이블에서 활성 core/extended 종목 목록 조회"""
    try:
        res = (
            supabase.table("stocks")
            .select("code")
            .in_("universe_level", ["core", "extended"])
            .eq("is_active", True)
            .execute()
        )
        return [r["code"] for r in (res.data or [])]
    except Exception as e:
        print(f"  종목 조회 실패: {e}")
        return []


def fetch_short_trade(sess: requests.Session, isin: str, start_date: str, end_date: str) -> dict:
    """
    MDCSTAT30102_OUT: 개별종목 일별 공매도 거래 데이터.
    Returns: {"20260515": {"short_volume": 136584, "short_ratio": 3.93}, ...}
    """
    result = {}
    try:
        r = sess.post(
            KRX_API_URL,
            data={
                "bld": "dbms/MDC_OUT/STAT/srt/MDCSTAT30102_OUT",
                "isuCd": isin,
                "strtDd": start_date,
                "endDd": end_date,
                "money": "1",
                "csvxls_isNo": "false",
            },
            timeout=10,
        )
        r.raise_for_status()
        for row in r.json().get("OutBlock_1", []):
            date_str = row.get("TRD_DD", "").replace("/", "")
            if len(date_str) != 8:
                continue
            try:
                volume = int(str(row.get("CVSRTSELL_TRDVOL", "0")).replace(",", "") or "0")
                ratio = float(str(row.get("TRDVOL_WT", "0")).replace(",", "") or "0")
                result[date_str] = {"short_volume": volume, "short_ratio": ratio}
            except (ValueError, TypeError):
                pass
    except Exception:
        pass
    return result


def fetch_short_balance(sess: requests.Session, isin: str, start_date: str, end_date: str) -> dict:
    """
    MDCSTAT30502_OUT: 개별종목 공매도 잔고 데이터.
    Returns: {"20260514": {"short_balance": 316122, "short_balance_ratio": 0.01}, ...}
    보고의무 기준이므로 일부 날짜만 존재할 수 있음.
    """
    result = {}
    try:
        r = sess.post(
            KRX_API_URL,
            data={
                "bld": "dbms/MDC_OUT/STAT/srt/MDCSTAT30502_OUT",
                "isuCd": isin,
                "strtDd": start_date,
                "endDd": end_date,
                "money": "1",
                "csvxls_isNo": "false",
            },
            timeout=10,
        )
        r.raise_for_status()
        for row in r.json().get("OutBlock_1", []):
            date_str = row.get("RPT_DUTY_OCCR_DD", "").replace("/", "")
            if len(date_str) != 8:
                continue
            try:
                balance = int(str(row.get("BAL_QTY", "0")).replace(",", "") or "0")
                result[date_str] = {"short_balance": balance}
            except (ValueError, TypeError):
                pass
    except Exception:
        pass
    return result


def _upsert_batch(rows: list) -> None:
    try:
        supabase.table("stock_credit_short_daily").upsert(
            rows, on_conflict="code,date"
        ).execute()
    except Exception as e:
        print(f"    배치 upsert 오류: {e} - 50개씩 재시도")
        for i in range(0, len(rows), 50):
            try:
                supabase.table("stock_credit_short_daily").upsert(
                    rows[i:i + 50], on_conflict="code,date"
                ).execute()
            except Exception as e2:
                print(f"    소분할 upsert 오류: {e2}")


def backfill_credit_short_daily(
    start_date: str,
    end_date: str,
    dry_run: bool = False,
) -> dict:
    """공매도 데이터 백필 메인 함수"""
    print(f"\n[공매도 데이터 백필]")
    print(f"  범위: {start_date} ~ {end_date}  dry_run={dry_run}")

    # 1. KRX 세션 및 ISIN 매핑
    print("\n  [1/4] KRX 세션 초기화 및 ISIN 매핑 조회...")
    sess = get_krx_session()
    isin_map = load_isin_map(sess)
    print(f"  ISIN 매핑: {len(isin_map)}개 종목")
    if not isin_map:
        return {"success": 0, "fail": 0, "total": 0}

    # 2. 거래일 목록
    print("\n  [2/4] 거래일 목록 조회...")
    trading_dates = get_trading_dates(start_date, end_date)
    if not trading_dates:
        print("  거래일 없음")
        return {"success": 0, "fail": 0, "total": 0}
    print(f"  거래일: {len(trading_dates)}일 ({trading_dates[0]} ~ {trading_dates[-1]})")

    # 3. 대상 종목 목록
    print("\n  [3/4] 대상 종목 조회...")
    codes = load_target_codes()
    print(f"  대상 종목: {len(codes)}개")
    if not codes:
        return {"success": 0, "fail": 0, "total": 0}

    # 4. 종목별 공매도 데이터 수집
    print(f"\n  [4/4] 종목별 공매도 데이터 수집 시작...")
    success = 0
    fail = 0
    batch_rows = []
    BATCH_SIZE = 500

    for idx, code in enumerate(codes):
        isin = isin_map.get(code)
        if not isin:
            fail += 1
            continue

        trade_data = fetch_short_trade(sess, isin, start_date, end_date)
        balance_data = fetch_short_balance(sess, isin, start_date, end_date)

        has_data = False
        for date_str in trading_dates:
            trade = trade_data.get(date_str, {})
            balance = balance_data.get(date_str, {})

            short_volume = trade.get("short_volume")
            short_ratio = trade.get("short_ratio")
            short_balance = balance.get("short_balance")

            if short_volume is not None or short_ratio is not None or short_balance is not None:
                batch_rows.append({
                    "code": code,
                    "date": to_iso(date_str),
                    "credit_ratio": None,
                    "short_ratio": short_ratio,
                    "short_balance": short_balance,
                    "short_volume": short_volume,
                })
                has_data = True

        if has_data:
            success += 1
        else:
            fail += 1

        if len(batch_rows) >= BATCH_SIZE and not dry_run:
            _upsert_batch(batch_rows)
            batch_rows = []

        if (idx + 1) % 50 == 0 or (idx + 1) == len(codes):
            print(f"    진행: {idx+1}/{len(codes)} | 성공: {success} | 실패: {fail} | 대기: {len(batch_rows)}건")

        time.sleep(0.05)

    if batch_rows and not dry_run:
        _upsert_batch(batch_rows)
        print(f"    마지막 배치 {len(batch_rows)}건 저장 완료")

    print(f"\n  완료: 성공={success} / 실패={fail} / 전체={len(codes)}")
    return {"success": success, "fail": fail, "total": len(codes)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="공매도 데이터 백필")
    parser.add_argument("--start", required=True, help="시작일 YYYYMMDD")
    parser.add_argument("--end", required=True, help="종료일 YYYYMMDD")
    parser.add_argument("--dry-run", action="store_true", help="DB 저장 없이 테스트")
    args = parser.parse_args()

    result = backfill_credit_short_daily(
        start_date=args.start,
        end_date=args.end,
        dry_run=args.dry_run,
    )
    print(f"\n결과: {result}")
    sys.exit(0 if result.get("success", 0) > 0 else 1)
