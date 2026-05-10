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


# ── 공매도 데이터 수집 (KRX) ────────────────────────────
# PyKRX는 쿠키 없이 직접 POST → KRX가 LOGOUT 반환.
# 해결: PyKRX의 Post.read()를 공유 세션(쿠키 포함)으로 monkey-patch.
KRX_MAIN_PAGE  = "https://data.krx.co.kr/"
KRX_SHORT_MENU = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020201"
KRX_REFERER    = KRX_SHORT_MENU
KRX_URL        = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
KRX_HEADERS = {
    "User-Agent": UA,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Referer": KRX_REFERER,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": "https://data.krx.co.kr",
}

_krx_session: "requests.Session | None" = None
_krx_blocked: bool = False   # 연속 LOGOUT → 전체 차단 플래그

def get_krx_session(force: bool = False) -> "requests.Session":
    """KRX 세션 초기화 (3단계 웜업 → JSESSIONID 활성화)."""
    global _krx_session
    if _krx_session is not None and not force:
        return _krx_session
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"})
    try:
        s.get(KRX_MAIN_PAGE,  timeout=15, allow_redirects=True)
        time.sleep(0.8)
        s.get(KRX_SHORT_MENU, timeout=15, allow_redirects=True)
        time.sleep(0.8)
        cookies = list(s.cookies.keys())
        print(f"  [KRX] 세션 초기화 완료 (쿠키: {cookies})")
    except Exception as e:
        print(f"  [KRX] 세션 초기화 실패: {e}")
    _krx_session = s
    return s

def _patch_pykrx_session(session: "requests.Session") -> None:
    """
    PyKRX의 Post.read()를 공유 세션으로 교체.
    쿠키 없이 POST하면 KRX가 LOGOUT을 반환하므로 필수.
    """
    if not HAS_PYKRX:
        return
    try:
        from pykrx.website.comm import webio
        original_post_read = webio.Post.read

        def _patched_read(self, **params):
            try:
                resp = session.post(
                    self.url,
                    headers={**self.headers, **KRX_HEADERS},
                    data=params,
                    timeout=30,
                )
                return resp
            except Exception:
                return original_post_read(self, **params)

        webio.Post.read = _patched_read
        print("  [PyKRX] Session monkey-patch 적용 완료")
    except Exception as e:
        print(f"  [PyKRX] patch 실패 (무시): {e}")

def _build_isin(code6: str) -> str:
    return f"KR7{code6.zfill(6)}0003"

def _parse_krx_num(s) -> Optional[float]:
    return safe_float(str(s).replace(",", "").strip())

def _krx_post(form: dict, timeout: int = 20) -> "dict | None":
    """KRX API POST (세션 쿠키 포함) — 실패 시 None 반환."""
    global _krx_blocked
    if _krx_blocked:
        return None
    session = get_krx_session()
    for attempt in range(2):
        try:
            resp = session.post(KRX_URL, data=form, headers=KRX_HEADERS, timeout=timeout)
            body = resp.text[:300]
            is_logout = "LOGOUT" in body or (not resp.ok and resp.status_code in (400, 401, 403))
            if is_logout:
                if attempt == 0:
                    time.sleep(2)
                    session = get_krx_session(force=True)
                    _patch_pykrx_session(session)
                    continue
                # 2회 연속 LOGOUT → 전체 차단으로 판단
                print("  ❌ KRX API 차단됨 (LOGOUT 연속) — 공매도 수집 중단")
                _krx_blocked = True
                return None
            if not resp.ok:
                print(f"    KRX {resp.status_code}: {body[:200]}")
                return None
            data = resp.json()
            if isinstance(data, str) and "LOGOUT" in data:
                _krx_blocked = True
                return None
            return data
        except Exception as e:
            print(f"    KRX 요청 에러: {e}")
            return None
    return None


def _parse_krx_short_rows(rows: list) -> "dict[str, dict]":
    """KRX 응답 rows → { code: {short_ratio, short_balance, short_volume} }"""
    if rows:
        print(f"    KRX 응답 키: {list(rows[0].keys())}")  # 키 확인용
    result: dict[str, dict] = {}
    for row in rows:
        raw_code = str(row.get("ISU_SRT_CD") or row.get("ISU_CD") or "")
        code = raw_code.strip().lstrip("A").zfill(6)
        if not code or len(code) != 6:
            continue
        ratio   = _parse_krx_num(row.get("STCK_BAL_RT") or row.get("BAL_RT") or row.get("SLVL_RT") or 0)
        balance = _parse_krx_num(row.get("END_SNTT_STKCNT") or row.get("BAL_STKCNT") or 0)
        volume  = _parse_krx_num(row.get("SLVL_VOL") or row.get("ACC_TRDVOL") or 0)
        if ratio or balance:
            result[code] = {
                "short_ratio":   round(ratio, 4) if ratio else None,
                "short_balance": int(balance) if balance else None,
                "short_volume":  int(volume) if volume else None,
            }
    return result


def _fetch_short_via_pykrx(trading_date: str) -> "dict[str, dict]":
    """PyKRX를 이용한 공매도 잔고 수집 (세션 monkey-patch 적용)."""
    result: dict[str, dict] = {}
    if not HAS_PYKRX:
        return result

    # 세션 초기화 후 PyKRX에 주입
    session = get_krx_session()
    _patch_pykrx_session(session)

    for mkt, mkt_label in [("KOSPI", "KOSPI"), ("KOSDAQ", "KOSDAQ")]:
        try:
            df = krx_stock.get_shorting_balance_top50(trading_date, market=mkt)
            if df is None or df.empty:
                print(f"    [PyKRX] {mkt_label}: 데이터 없음")
                continue
            # 컬럼명 후보 (PyKRX 버전에 따라 다름)
            RATIO_COLS   = ["공매도잔고비율", "잔고비율", "비율"]
            BALANCE_COLS = ["공매도잔고", "잔고"]
            ratio_col   = next((c for c in RATIO_COLS   if c in df.columns), None)
            balance_col = next((c for c in BALANCE_COLS if c in df.columns), None)
            added = 0
            for ticker in df.index:
                code = str(ticker).lstrip("A").zfill(6)
                if not code or len(code) != 6:
                    continue
                ratio   = safe_float(df.at[ticker, ratio_col])   if ratio_col   else None
                balance = safe_float(df.at[ticker, balance_col]) if balance_col else None
                if ratio or balance:
                    result[code] = {
                        "short_ratio":   round(ratio, 4) if ratio   else None,
                        "short_balance": int(balance)   if balance  else None,
                        "short_volume":  None,
                    }
                    added += 1
            print(f"    [PyKRX] {mkt_label}: {added}개")
        except Exception as e:
            print(f"    [PyKRX] {mkt_label} 실패: {e}")
        time.sleep(1)

    return result


def fetch_shorting_all_markets(trading_date: str) -> "dict[str, dict]":
    """
    KRX 공매도 잔고 조회.
    전략 A: PyKRX top50 (KRX 세션 내부 처리, 안정적)
    전략 B: KRX 직접 API (HTTPS, 세션 쿠키) — PyKRX 실패 시
    전략 C: 종목별 개별 조회 (core 종목) — 위 두 전략 모두 실패 시
    """
    result: dict[str, dict] = {}

    # ── 전략 A: PyKRX 우선 ──
    if HAS_PYKRX:
        print("  [전략A] PyKRX 공매도 잔고 상위 종목 조회...")
        result = _fetch_short_via_pykrx(trading_date)
        if len(result) >= 50:
            print(f"  📊 공매도 수집 종목: {len(result)}개 (PyKRX)")
            return result
        print(f"  ⚠️ PyKRX 결과 부족 ({len(result)}개) → 직접 API 시도")

    # ── 전략 B: KRX 직접 API (HTTPS) ──
    print("  [전략B] KRX 직접 API 공매도 잔고 상위 종목 조회...")
    for mkt_tp, mkt_label in [("1", "KOSPI"), ("2", "KOSDAQ")]:
        data = _krx_post({
            "bld":          "dbms/MDC/STAT/standard/MDCSTAT10701",
            "mktTpCd":      mkt_tp,
            "trdDd":        trading_date,
            "money":        "1",
            "csvxls_isNo":  "false",
        })
        if data:
            rows = data.get("OutBlock_1") or data.get("outBlock_1") or []
            parsed = _parse_krx_short_rows(rows)
            result.update(parsed)
            print(f"    {mkt_label} 상위 종목: {len(parsed)}개")
        time.sleep(1.5)

    # ── 전략 C: 종목별 잔고 조회 (core 종목) ──
    if len(result) < 10:
        print("  [전략C] 종목별 공매도 잔고 개별 조회 (core)...")
        try:
            res = supabase.table("stocks").select("code") \
                .eq("is_active", True).in_("universe_level", ["core"]) \
                .order("mcap_rank").limit(100).execute()
            codes = [r["code"] for r in (res.data or [])]
        except Exception:
            codes = []

        ok = 0
        for code in codes:
            if _krx_blocked:
                print("  ❌ KRX 차단 감지 → 전략C 조기 종료")
                break
            isin = _build_isin(code)
            data = _krx_post({
                "bld":          "dbms/MDC/STAT/standard/MDCSTAT10401",
                "isuCd":        isin,
                "strtDd":       trading_date,
                "endDd":        trading_date,
                "money":        "1",
                "csvxls_isNo":  "false",
            }, timeout=10)
            if data:
                rows = data.get("OutBlock_1") or data.get("outBlock_1") or []
                parsed = _parse_krx_short_rows(rows)
                if parsed:
                    result.update(parsed)
                    ok += 1
            time.sleep(0.5)
        print(f"    종목별 조회: {ok}/{len(codes)} 성공")

    print(f"  📊 공매도 수집 종목: {len(result)}개")
    return result


# ── 신용비율 수집 (Naver Finance HTML) ───────────────────
def fetch_credit_ratio_naver(code: str) -> Optional[float]:
    """
    [DEPRECATED] Naver Finance가 React SPA(stock.naver.com)로 마이그레이션되면서
    HTML 스크래핑이 불가능해졌습니다. 신용비율 API 엔드포인트가 공개되지 않아
    현재 수집 불가. 항상 None 반환.

    TODO: stock.naver.com SPA API 엔드포인트 확인 후 복구 필요.
    """
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
    if not SKIP_SHORT:
        print("\n[1/2] 공매도 잔고 수집 (KRX 직접 API)...")
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
