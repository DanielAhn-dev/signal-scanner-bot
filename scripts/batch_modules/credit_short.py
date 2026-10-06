"""
batch_modules/credit_short.py
============================
STEP 2.6: ???/?? ??? ??
"""

import time
import os
import requests
from datetime import datetime, timedelta
from supabase import Client
from .utils import to_iso, is_krx_trading_day


def post_json_with_retry(sess: requests.Session, url: str, data: dict, timeout: int = 10, retries: int = 3) -> tuple[dict | None, bool]:
    """POST JSON with small retry/backoff. Returns (json, ok)."""
    for attempt in range(1, retries + 1):
        try:
            r = sess.post(url, data=data, timeout=timeout)
            r.raise_for_status()
            return r.json(), True
        except Exception:
            if attempt >= retries:
                break
            time.sleep(0.2 * attempt)
    return None, False


def build_isin_fallback(code6: str) -> str:
    """Fallback ISIN pattern used by KRX endpoints for stock code lookup."""
    return f"KR7{str(code6).zfill(6)}0003"


def fetch_credit_short_data(supabase: Client, trading_date: str):
    """Collect credit/short-selling data from KRX MDC_OUT APIs."""
    trading_iso = to_iso(trading_date)
    print(f"\n[2.6/7] Collecting credit/short data (KRX MDC_OUT API)...")

    if os.environ.get("DISABLE_CREDIT_SHORT_FETCH", "false").lower() in ("1", "true", "yes"):
        print("  DISABLE_CREDIT_SHORT_FETCH=true, skipping credit/short fetch")
        return

    try:
        res = (
            supabase.table("stocks")
            .select("code")
            .in_("universe_level", ["core", "extended"])
            .eq("is_active", True)
            .execute()
        )
        codes = [r["code"] for r in (res.data or [])]
        if not codes:
            print("  No active stocks found")
            return
        print(f"  universe size: {len(codes)} tickers")

        # 이미 당일 신용/공매도 데이터가 대부분 적재돼 있으면 재수집을 건너뛴다.
        # (수동 재실행 + 스케줄 실행 중복 시 KRX 트래픽이 2배로 늘어 IP 차단 위험이 커짐 - 2026-08-31 사고 참고)
        if os.environ.get("CREDIT_SHORT_FORCE_REFETCH", "").lower() not in ("1", "true", "yes"):
            try:
                existing_res = (
                    supabase.table("stock_credit_short_daily")
                    .select("code", count="exact")
                    .eq("date", trading_iso)
                    .eq("collection_status", "ok")
                    .limit(1)
                    .execute()
                )
                existing_count = int(getattr(existing_res, "count", 0) or 0)
                if existing_count >= len(codes) * 0.9:
                    print(f"  이미 당일({trading_iso}) 신용/공매도 데이터 {existing_count}/{len(codes)}건 적재됨 → 재수집 스킵")
                    return
            except Exception as e:
                print(f"  [WARN] 기존 신용/공매도 데이터 확인 실패, 정상 수집 진행: {e}")

        krx_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        krx_headers = {
            "User-Agent": krx_ua,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://data.krx.co.kr/",
        }
        krx_api = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
        sess = requests.Session()
        sess.headers.update(krx_headers)
        try:
            sess.get("https://data.krx.co.kr/", timeout=10)
        except Exception:
            pass

        # Build ISIN map
        isin_map = {}
        try:
            payload, ok = post_json_with_retry(
                sess,
                krx_api,
                {"bld": "dbms/comm/finder/finder_stkisu", "mktsel": "ALL", "typeNo": "0", "pagePath": "/contents/MDC/STAT/srt/MDCSTAT300.cmd", "codeNm": ""},
                timeout=30,
                retries=3,
            )
            block = (payload or {}).get("block1", []) if ok else []
            isin_map = {item["short_code"]: item["full_code"] for item in block}
        except Exception as e:
            print(f"  ISIN mapping failed: {e}")

        cs_rows = []
        success_count = 0
        fail_count = 0
        fail_reasons: dict[str, int] = {"missing_isin": 0, "fallback_isin": 0, "api_error": 0}
        sample_failed_codes: list[str] = []
        request_retries = max(1, int(os.environ.get("CREDIT_SHORT_API_RETRIES", "3")))
        start_d = (datetime.strptime(trading_date, "%Y%m%d") - timedelta(days=7)).strftime("%Y%m%d")
        end_d = trading_date

        # 이어받기: 같은 날 이미 정상(ok) 적재된 종목은 다시 요청하지 않는다(KRX 트래픽 최소화).
        already_ok: set[str] = set()
        if os.environ.get("CREDIT_SHORT_FORCE_REFETCH", "").lower() not in ("1", "true", "yes"):
            try:
                ex = (
                    supabase.table("stock_credit_short_daily")
                    .select("code")
                    .eq("date", trading_iso)
                    .eq("collection_status", "ok")
                    .range(0, 4999)
                    .execute()
                )
                already_ok = {r["code"] for r in (ex.data or [])}
            except Exception as e:
                print(f"  [WARN] 기존 정상 적재 종목 조회 실패, 전체 수집: {e}")
        if already_ok:
            print(f"  이미 정상 적재된 {len(already_ok)}종목은 건너뜀(이어받기)")

        # KRX가 자동화 접속으로 보고 응답을 끊으면(2026-10-02: 68종목 뒤 165종목 연속 실패) 계속 두드릴수록 길어진다.
        # 연속 실패가 이어지면 잠시 쉬었다가 재개하고, 쉬어도 안 풀리면 중단해 이미 모은 것만 저장한다(다음 실행이 이어받음).
        cooldown_sec = int(os.environ.get("CREDIT_SHORT_COOLDOWN_SEC", "180"))
        max_cooldowns = int(os.environ.get("CREDIT_SHORT_MAX_COOLDOWNS", "3"))
        consecutive_fail_limit = int(os.environ.get("CREDIT_SHORT_CONSECUTIVE_FAILS", "10"))
        consecutive_fail = 0
        cooldowns_used = 0
        aborted_codes: list[str] = []

        for idx, code in enumerate(codes):
            if code in already_ok:
                success_count += 1
                continue
            if idx % 50 == 0 and idx > 0:
                print(f"  progress: {idx}/{len(codes)} (success: {success_count}, fail: {fail_count})")

            if consecutive_fail >= consecutive_fail_limit:
                if cooldowns_used >= max_cooldowns:
                    aborted_codes = [c for c in codes[idx:] if c not in already_ok]
                    print(f"  KRX 연속 실패가 {max_cooldowns}회 쉰 뒤에도 풀리지 않아 중단: 남은 {len(aborted_codes)}종목은 다음 실행이 이어받음")
                    break
                cooldowns_used += 1
                print(f"  KRX 연속 실패 {consecutive_fail}건 → {cooldown_sec}초 쉼({cooldowns_used}/{max_cooldowns})")
                time.sleep(cooldown_sec)
                consecutive_fail = 0
                try:
                    sess.get("https://data.krx.co.kr/", timeout=10)
                except Exception:
                    pass

            isin = isin_map.get(code)
            if not isin:
                # Some valid listed tickers are occasionally absent from finder_stkisu.
                # Try deterministic fallback ISIN before counting as failure.
                fail_reasons["fallback_isin"] += 1
                isin = build_isin_fallback(code)

            short_volume = None
            short_ratio = None
            short_balance = None
            vol_query_ok = False
            bal_query_ok = False
            volume_status = "api_error"
            balance_status = "api_error"

            # Short-selling volume only. short_ratio column is reserved for balance ratio.
            payload, ok = post_json_with_retry(
                sess,
                krx_api,
                {"bld": "dbms/MDC_OUT/STAT/srt/MDCSTAT30102_OUT", "isuCd": isin, "strtDd": start_d, "endDd": end_d, "money": "1", "csvxls_isNo": "false"},
                timeout=10,
                retries=request_retries,
            )
            if ok:
                vol_query_ok = True
                matched = False
                for row in (payload or {}).get("OutBlock_1", []):
                    date_str = row.get("TRD_DD", "").replace("/", "")
                    if date_str == trading_date:
                        short_volume = int(str(row.get("CVSRTSELL_TRDVOL", "0")).replace(",", "") or "0")
                        matched = True
                        break
                if not matched:
                    # 정상 응답이지만 해당일 데이터가 없다는 사실을 0과 구분해 보존한다.
                    short_volume = 0
                    volume_status = "no_row"
                else:
                    volume_status = "ok"

            # Short balance and balance ratio
            payload, ok = post_json_with_retry(
                sess,
                krx_api,
                {"bld": "dbms/MDC_OUT/STAT/srt/MDCSTAT30502_OUT", "isuCd": isin, "strtDd": start_d, "endDd": end_d, "money": "1", "csvxls_isNo": "false"},
                timeout=10,
                retries=request_retries,
            )
            if ok:
                bal_query_ok = True
                matched = False
                for row in (payload or {}).get("OutBlock_1", []):
                    date_str = row.get("RPT_DUTY_OCCR_DD", "").replace("/", "")
                    if date_str == trading_date:
                        short_balance = int(str(row.get("BAL_QTY", "0")).replace(",", "") or "0")
                        short_ratio = float(str(row.get("BAL_RT") or row.get("STCK_BAL_RT") or row.get("SLVL_RT") or "0").replace(",", "") or "0")
                        matched = True
                        break
                if not matched:
                    short_balance = 0
                    short_ratio = 0.0
                    balance_status = "no_row"
                else:
                    balance_status = "ok"

            if short_volume is not None or short_ratio is not None or short_balance is not None or vol_query_ok or bal_query_ok:
                if volume_status == "ok" and balance_status == "ok":
                    collection_status = "ok"
                    missing_reason = None
                elif volume_status == "api_error" or balance_status == "api_error":
                    collection_status = "partial"
                    missing_reason = "volume_api_error" if volume_status == "api_error" else "balance_api_error"
                else:
                    collection_status = "no_data"
                    missing_reason = "no_row_for_trading_date"
                cs_rows.append({
                    "code": code,
                    "date": trading_iso,
                    "credit_ratio": None,
                    "short_ratio": short_ratio,
                    "short_balance": short_balance,
                    "short_volume": short_volume,
                    "collection_status": collection_status,
                    "missing_reason": missing_reason,
                    "volume_status": volume_status,
                    "balance_status": balance_status,
                })
                success_count += 1
                consecutive_fail = 0
            else:
                fail_count += 1
                consecutive_fail += 1
                if code in isin_map:
                    fail_reasons["api_error"] += 1
                else:
                    fail_reasons["missing_isin"] += 1
                if len(sample_failed_codes) < 10:
                    sample_failed_codes.append(code)

            # 종목당 KRX 요청 2건 x 0.05초 대기 = 초당 약 40건의 지속 트래픽이었고,
            # 이는 KRX Data Marketplace의 "자동화 수단을 통한 비정상 대량 조회" 탐지 기준에
            # 해당해 IP 접속 제한(1일)을 유발했다. 종목당 요청 간격을 늘려 자동화 탐지를 피한다.
            time.sleep(0.5)

        if cs_rows:
            for i in range(0, len(cs_rows), 500):
                batch = cs_rows[i:i + 500]
                try:
                    supabase.table("stock_credit_short_daily").upsert(batch, on_conflict="code,date").execute()
                except Exception as e:
                    print(f"    stock_credit_short_daily upsert error: {e}")
                    for j in range(0, len(batch), 50):
                        try:
                            supabase.table("stock_credit_short_daily").upsert(batch[j:j + 50], on_conflict="code,date").execute()
                        except Exception:
                            pass

            # Sync latest short fields into stocks table
            for r in cs_rows:
                try:
                    upd = {}
                    if r.get("short_ratio") is not None:
                        upd["short_ratio"] = r["short_ratio"]
                    if r.get("short_balance") is not None:
                        upd["short_balance"] = r["short_balance"]
                    if upd:
                        supabase.table("stocks").update(upd).eq("code", r["code"]).execute()
                except Exception:
                    pass

            print(f"  Stored {len(cs_rows)} credit/short rows (success: {success_count}, fail: {fail_count}, 중단으로 미수집: {len(aborted_codes)})")
            if fail_count > 0:
                print(
                    "  fail detail: "
                    f"missing_isin={fail_reasons.get('missing_isin', 0)}, "
                    f"fallback_isin={fail_reasons.get('fallback_isin', 0)}, "
                    f"api_error={fail_reasons.get('api_error', 0)}"
                )
                if sample_failed_codes:
                    print(f"  failed sample codes: {', '.join(sample_failed_codes)}")
        else:
            print(f"  No credit/short rows collected (success: {success_count}, fail: {fail_count})")

        # KRX가 막혀 못 받았거나 부분인 종목은 한국투자증권 API로 거래량·신용잔고율만이라도 채운다(잔고는 KRX 전용).
        if os.environ.get("CREDIT_SHORT_KIS_FALLBACK", "true").lower() not in ("0", "false", "no"):
            try:
                from .kis_credit_short import fill_with_kis
                # 신용잔고는 결제일(T+2) 기준이라 당일치는 늦게 공시된다 → 최근 3거래일을 다시 본다(ok인 종목은 건너뜀)
                recent, cur = [], datetime.strptime(trading_date, "%Y%m%d").date()
                while len(recent) < 3 and (datetime.strptime(trading_date, "%Y%m%d").date() - cur).days < 10:
                    if is_krx_trading_day(cur):
                        recent.append(cur.strftime("%Y%m%d"))
                    cur -= timedelta(days=1)
                recent.sort()
                fill_with_kis(supabase, recent[0], recent[-1], codes, recent)
            except Exception as e:
                print(f"  [KIS 보조] 실패(무시): {e}")

    except Exception as e:
        print(f"  credit/short collection failed: {e}")
        import traceback
        traceback.print_exc()


