"""
batch_modules/investor.py
========================
STEP 2.5: KIS Open API 기반 투자자 수급 수집
- endpoint: GET /uapi/domestic-stock/v1/quotations/inquire-investor
- tr_id: FHKST01010900
- 기관/외국인 순매수 거래대금(백만원) → investor_daily 저장
"""

import os
import time
import json
import requests
from typing import Optional
from supabase import Client
from .utils import to_iso, safe_int


KIS_BASE = "https://openapi.koreainvestment.com:9443"
KIS_TOKEN_CACHE = os.path.join(os.path.dirname(__file__), ".._kis_token.json")
_token_cache: dict = {}


def _get_kis_token(app_key: str, app_secret: str) -> Optional[str]:
    """KIS 접근 토큰 발급 (24h 캐시)."""
    global _token_cache
    now = time.time()

    # 인-메모리 캐시
    if _token_cache.get("token") and now < _token_cache.get("expires_at", 0) - 300:
        return _token_cache["token"]

    # 파일 캐시
    cache_path = os.path.join(os.path.dirname(__file__), "_kis_token_cache.json")
    try:
        with open(cache_path) as f:
            cached = json.load(f)
        if now < cached.get("expires_at", 0) - 300:
            _token_cache = cached
            return cached["token"]
    except Exception:
        pass

    # 신규 발급 (1분에 1회 제한)
    try:
        resp = requests.post(
            f"{KIS_BASE}/oauth2/tokenP",
            headers={"content-type": "application/json"},
            json={"grant_type": "client_credentials", "appkey": app_key, "appsecret": app_secret},
            timeout=15,
        )
        body = resp.json()
        if "access_token" not in body:
            print(f"   KIS 토큰 발급 실패: {body}")
            return None
        token = body["access_token"]
        expires_at = now + body.get("expires_in", 86400)
        _token_cache = {"token": token, "expires_at": expires_at}
        with open(cache_path, "w") as f:
            json.dump(_token_cache, f)
        return token
    except Exception as e:
        print(f"   KIS 토큰 발급 에러: {e}")
        return None


def _fetch_stock_investor(app_key: str, app_secret: str, token: str, code: str) -> Optional[dict]:
    """종목별 투자자 순매수 금액 (오늘 기준) 반환.
    Returns: {"institution": int, "foreign": int} (단위: 원)
    """
    try:
        resp = requests.get(
            f"{KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-investor",
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {token}",
                "appkey": app_key,
                "appsecret": app_secret,
                "tr_id": "FHKST01010900",
            },
            params={
                "FID_COND_MRKT_DIV_CODE": "J",
                "FID_INPUT_ISCD": code,
                "FID_DIV_CLS_CODE": "0",
            },
            timeout=10,
        )
        body = resp.json()
        if body.get("rt_cd") != "0":
            return None
        output = body.get("output", [])
        if isinstance(output, dict):
            output = [output]
        if not output:
            return None
        # output[0] = 가장 최근 거래일
        row = output[0]

        def pick(*keys: str):
            for key in keys:
                if key in row and row.get(key) not in (None, ""):
                    return row.get(key)
            return None

        # pbmn = 백만원 → 원 변환
        institution = safe_int(pick("orgn_ntby_tr_pbmn", "orgn_ntby_tr_pbmn1"), 0) * 1_000_000
        foreign = safe_int(pick("frgn_ntby_tr_pbmn", "frgn_ntby_tr_pbmn1"), 0) * 1_000_000
        personal = safe_int(pick("prsn_ntby_tr_pbmn", "prsn_ntby_tr_pbmn1"), 0) * 1_000_000
        date_str = str(pick("stck_bsop_date", "bsop_date", "stck_bsop_dt") or "")
        if len(date_str) == 8:
            date_iso = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
        else:
            return None
        if institution == 0 and foreign == 0:
            return None
        return {
            "date": date_iso,
            "institution": institution,
            "foreign": foreign,
            "personal": personal,
        }
    except Exception:
        return None


def fetch_investor_data(supabase: Client, trading_date: str):
    """KIS Open API로 투자자 수급 수집 → investor_daily 저장."""
    trading_iso = to_iso(trading_date)
    print(f"\n[2.5/7] Collecting investor flow data (KIS API)...")

    if os.environ.get("DISABLE_INVESTOR_FETCH", "").lower() in ("1", "true", "yes"):
        print("  DISABLE_INVESTOR_FETCH=true, skipping investor fetch.")
        return

    app_key = os.environ.get("KOREA_APP_KEY", "")
    app_secret = os.environ.get("KOREA_APP_SECRET", "")
    if not app_key or not app_secret:
        print("  KOREA_APP_KEY / KOREA_APP_SECRET 환경변수 없음, 스킵")
        return

    token = _get_kis_token(app_key, app_secret)
    if not token:
        print("  KIS 토큰 발급 실패, 스킵")
        return

    # 대상 종목 로딩
    try:
        res = supabase.table("stocks") \
            .select("code") \
            .in_("universe_level", ["core", "extended"]) \
            .eq("is_active", True).execute()
        codes = [r["code"] for r in (res.data or [])]
    except Exception as e:
        print(f"  종목 로딩 실패: {e}")
        return

    if not codes:
        print("  대상 종목 없음")
        return

    print(f"  대상 종목: {len(codes)}개")

    rows: list[dict] = []
    success = fail = token_err = 0

    for idx, code in enumerate(codes):
        if idx % 100 == 0 and idx > 0:
            print(f"  -> {idx}/{len(codes)} (success={success}, fail={fail})")

        result = _fetch_stock_investor(app_key, app_secret, token, code)

        if result is None:
            fail += 1
            # 토큰 만료 감지: 연속 실패 50개면 토큰 재발급 시도
            token_err += 1
            if token_err >= 50 and success == 0:
                print("  -> 연속 실패, 토큰 재발급 시도...")
                # 캐시 삭제 후 재발급
                cache_path = os.path.join(os.path.dirname(__file__), "_kis_token_cache.json")
                try:
                    os.remove(cache_path)
                except Exception:
                    pass
                global _token_cache
                _token_cache = {}
                time.sleep(65)  # 1분 대기 (KIS 1분 1회 제한)
                token = _get_kis_token(app_key, app_secret)
                if not token:
                    print("  -> 재발급 실패, 중단")
                    break
                token_err = 0
        else:
            token_err = 0
            success += 1
            rows.append({
                "date": result["date"],
                "ticker": code,
                "institution": result["institution"],
                "institution_amount": result["institution"],
                "foreign": result["foreign"],
                "foreign_amount": result["foreign"],
                "personal": result["personal"],
                "personal_amount": result["personal"],
            })

        time.sleep(0.12)  # ~8 req/sec (KIS 제한 여유있게)

    print(f"  -> 수집 완료: success={success}, fail={fail}")

    if not rows:
        print("  수집된 데이터 없음")
        return

    # investor_daily 저장
    batch_size = 500
    sub_batch_fail = 0
    for i in range(0, len(rows), batch_size):
        try:
            supabase.table("investor_daily").upsert(rows[i:i+batch_size], on_conflict="date,ticker").execute()
        except Exception as e:
            print(f"  investor_daily 저장 에러: {e}")
            # 소규모 배치로 재시도
            for j in range(0, len(rows[i:i+batch_size]), 50):
                try:
                    supabase.table("investor_daily").upsert(rows[i+j:i+j+50], on_conflict="date,ticker").execute()
                except Exception:
                    sub_batch_fail += 1

    print(f"  저장 완료: {len(rows)}개 종목 수급 데이터")
    if sub_batch_fail > 0:
        print(f"  [WARN] investor_daily 소배치 저장 실패: {sub_batch_fail}건")
