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
import subprocess
import requests
from datetime import date, timedelta
from typing import Optional
from supabase import Client
from .utils import to_iso, safe_int


KIS_BASE = "https://openapi.koreainvestment.com:9443"
KIS_TOKEN_CACHE = os.path.join(os.path.dirname(__file__), ".._kis_token.json")
_token_cache: dict = {}


def _business_days_between(start_iso: str, end_iso: str) -> Optional[int]:
    """Return business-day lag between two ISO dates (Mon-Fri only)."""
    try:
        start_d = date.fromisoformat(start_iso)
        end_d = date.fromisoformat(end_iso)
    except Exception:
        return None

    if end_d <= start_d:
        return 0

    cur = start_d + timedelta(days=1)
    days = 0
    while cur <= end_d:
        if cur.weekday() < 5:
            days += 1
        cur += timedelta(days=1)
    return days


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


def _compact_kis_error(body: dict, status_code: int) -> str:
    rt_cd = str(body.get("rt_cd", ""))
    msg_cd = str(body.get("msg_cd", ""))
    msg1 = str(body.get("msg1", "")).strip()
    tr_cont = str(body.get("tr_cont", ""))
    parts = [f"http={status_code}"]
    if rt_cd:
        parts.append(f"rt_cd={rt_cd}")
    if msg_cd:
        parts.append(f"msg_cd={msg_cd}")
    if tr_cont:
        parts.append(f"tr_cont={tr_cont}")
    if msg1:
        parts.append(f"msg1={msg1}")
    return " | ".join(parts)


def _fetch_stock_investor(app_key: str, app_secret: str, token: str, code: str) -> tuple[Optional[dict], Optional[str]]:
    """종목별 투자자 순매수 금액 (오늘 기준) 반환.
    Returns: {"institution": int, "foreign": int} (단위: 원)
    """
    try:
        timeout_sec = float(os.environ.get("INVESTOR_KIS_TIMEOUT_SEC", "4"))
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
            timeout=timeout_sec,
        )
        body = resp.json()
        if body.get("rt_cd") != "0":
            return None, _compact_kis_error(body if isinstance(body, dict) else {}, resp.status_code)
        output = body.get("output", [])
        if isinstance(output, dict):
            output = [output]
        if not output:
            return None, f"http={resp.status_code} | rt_cd=0 | empty_output"
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
            return None, f"http={resp.status_code} | invalid_date_field"
        if institution == 0 and foreign == 0:
            return None, f"http={resp.status_code} | zero_flow"
        return {
            "date": date_iso,
            "institution": institution,
            "foreign": foreign,
            "personal": personal,
        }, None
    except Exception as e:
        return None, f"exception={type(e).__name__}: {e}"


def _run_naver_fallback(trading_iso: str) -> tuple[bool, str]:
    """Run Naver-based investor backfill for recent window as fallback."""
    target = date.fromisoformat(trading_iso)
    lookback_days = int(os.environ.get("INVESTOR_FALLBACK_DAYS", "45"))
    start = (target - timedelta(days=max(1, lookback_days))).strftime("%Y%m%d")
    end = target.strftime("%Y%m%d")
    cmd = [
        "python",
        "scripts/backfill_investor_daily.py",
        "--start",
        start,
        "--end",
        end,
        "--max-pages",
        os.environ.get("INVESTOR_FALLBACK_MAX_PAGES", "20"),
        "--sleep",
        os.environ.get("INVESTOR_FALLBACK_SLEEP", "0.01"),
    ]
    try:
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        tail = ""
        if result.stdout:
            lines = [ln for ln in result.stdout.splitlines() if ln.strip()]
            if lines:
                tail = lines[-1]
        return True, tail or "fallback_ok"
    except Exception as e:
        return False, str(e)


def fetch_investor_data(supabase: Client, trading_date: str) -> dict:
    """KIS Open API로 투자자 수급 수집 → investor_daily 저장.

    Returns a status dict used by daily batch reliability gates.
    """
    trading_iso = to_iso(trading_date)
    print(f"\n[2.5/7] Collecting investor flow data (KIS API)...")

    status = {
        "ok": False,
        "skipped": False,
        "reason": "",
        "success_count": 0,
        "fail_count": 0,
        "stored_count": 0,
        "latest_date": None,
        "stale_business_days": None,
    }

    if os.environ.get("DISABLE_INVESTOR_FETCH", "").lower() in ("1", "true", "yes"):
        print("  DISABLE_INVESTOR_FETCH=true, skipping investor fetch.")
        status["skipped"] = True
        status["reason"] = "disabled"
        return status

    app_key = os.environ.get("KOREA_APP_KEY", "")
    app_secret = os.environ.get("KOREA_APP_SECRET", "")
    if not app_key or not app_secret:
        print("  [WARN] ============================================================")
        print("  [WARN] KOREA_APP_KEY / KOREA_APP_SECRET 환경변수 없음")
        print("  [WARN] investor_daily 수집 불가 → 기관/외국인 수급 데이터 미갱신")
        print("  [WARN] 매매 신호의 수급 기반 판단이 부정확해집니다.")
        print("  [WARN] .env 파일에 KIS Open API 키를 추가하세요.")
        print("  [WARN] ============================================================")
        status["reason"] = "missing_env"
        return status

    token = _get_kis_token(app_key, app_secret)
    if not token:
        print("  KIS 토큰 발급 실패, 스킵")
        status["reason"] = "token_error"
        return status

    # 대상 종목 로딩
    try:
        res = supabase.table("stocks") \
            .select("code") \
            .in_("universe_level", ["core", "extended"]) \
            .eq("is_active", True).execute()
        codes = [r["code"] for r in (res.data or [])]
    except Exception as e:
        print(f"  종목 로딩 실패: {e}")
        status["reason"] = "stock_load_failed"
        return status

    if not codes:
        print("  대상 종목 없음")
        status["reason"] = "no_target_codes"
        return status

    print(f"  대상 종목: {len(codes)}개")

    rows: list[dict] = []
    success = fail = token_err = 0
    fail_reason_count: dict[str, int] = {}
    fail_reason_samples: list[str] = []

    for idx, code in enumerate(codes):
        if idx % 100 == 0 and idx > 0:
            print(f"  -> {idx}/{len(codes)} (success={success}, fail={fail})")

        result, fail_reason = _fetch_stock_investor(app_key, app_secret, token, code)

        if result is None:
            fail += 1
            if fail_reason:
                fail_reason_count[fail_reason] = fail_reason_count.get(fail_reason, 0) + 1
                if len(fail_reason_samples) < 5:
                    fail_reason_samples.append(f"{code}: {fail_reason}")
                if len(fail_reason_samples) == 1:
                    print(f"  [DEBUG] first KIS fail: {fail_reason_samples[0]}")
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
            max_initial_fail = int(os.environ.get("INVESTOR_KIS_MAX_INITIAL_FAIL", "40"))
            if success == 0 and fail >= max_initial_fail:
                print(f"  -> 초기 구간 연속 실패({fail}건)로 KIS 수집을 조기 중단합니다.")
                break
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
    status["success_count"] = success
    status["fail_count"] = fail
    if fail_reason_samples:
        print("  [DEBUG] KIS failure samples:")
        for sample in fail_reason_samples:
            print(f"    - {sample}")
    if fail_reason_count:
        top_reasons = sorted(fail_reason_count.items(), key=lambda x: x[1], reverse=True)[:3]
        print("  [DEBUG] KIS failure top reasons:")
        for reason, cnt in top_reasons:
            print(f"    - {cnt}x {reason}")

    if not rows:
        print("  수집된 데이터 없음")
        fallback_enabled = os.environ.get("INVESTOR_ENABLE_NAVER_FALLBACK", "true").lower() in ("1", "true", "yes")
        if fallback_enabled:
            print("  -> Naver fallback 실행...")
            fb_ok, fb_note = _run_naver_fallback(trading_iso)
            print(f"  -> fallback result: ok={fb_ok} note={fb_note}")
            if fb_ok:
                try:
                    cnt_res = supabase.table("investor_daily").select("ticker", count="exact").eq("date", trading_iso).limit(1).execute()
                    fallback_count = int(getattr(cnt_res, "count", 0) or 0)
                except Exception:
                    fallback_count = 0
                if fallback_count > 0:
                    status["ok"] = True
                    status["stored_count"] = fallback_count
                    status["latest_date"] = trading_iso
                    status["stale_business_days"] = 0
                    status["reason"] = "fallback_naver"
                    return status
                try:
                    latest_res = supabase.table("investor_daily").select("date").order("date", desc=True).limit(1).maybe_single().execute()
                    latest_existing = str((latest_res.data or {}).get("date") or "") if latest_res else ""
                except Exception:
                    latest_existing = ""
                if latest_existing:
                    status["latest_date"] = latest_existing
                    status["stale_business_days"] = _business_days_between(latest_existing, trading_iso)
                    allow_existing_stale = int(os.environ.get("INVESTOR_ACCEPT_EXISTING_MAX_STALE", "1"))
                    if status["stale_business_days"] is not None and status["stale_business_days"] <= allow_existing_stale:
                        status["ok"] = True
                        status["reason"] = "existing_recent"
                        return status
        status["reason"] = "no_rows"
        return status

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
    status["stored_count"] = len(rows)
    if sub_batch_fail > 0:
        print(f"  [WARN] investor_daily 소배치 저장 실패: {sub_batch_fail}건")

    latest_date = max(r.get("date") for r in rows if r.get("date"))
    stale_days = _business_days_between(latest_date, trading_iso) if latest_date else None
    status["latest_date"] = latest_date
    status["stale_business_days"] = stale_days
    if stale_days is not None and stale_days > 1:
        print(f"  [WARN] investor data stale: latest={latest_date}, trading={trading_iso}, lag={stale_days} business days")

    status["ok"] = True
    return status
