"""
batch_modules/kis_credit_short.py
=================================
KRX가 자동화 접속을 차단했을 때(2026-10-02: 68종목 뒤 연속 실패) 쓰는 신용/공매도 보조 수집원 — 한국투자증권 Open API.
- 공매도 일별추이: GET /uapi/domestic-stock/v1/quotations/daily-short-sale (tr_id FHPST04830000)
    ssts_cntg_qty = 공매도 체결 수량(→ short_volume), 기간 조회 1회로 여러 거래일
- 신용잔고 일별추이: GET /uapi/domestic-stock/v1/quotations/daily-credit-balance (tr_id FHPST04760000)
    whol_loan_rmnd_rate = 신용잔고율 %(→ credit_ratio, KRX 경로로는 수집된 적 없음), deal_date = 매매일
공매도 잔고(short_balance·short_ratio)는 KIS에 없어 KRX에서만 받는다. 그래서 KIS로 채운 행은 collection_status='partial'
(missing_reason='balance_krx_only')로 두고, 다음 KRX 수집이 같은 종목을 다시 받아 'ok'로 올린다.
"""

import os
import time
import requests
from typing import Optional
from supabase import Client
from .investor import KIS_BASE, _get_kis_token
from .utils import to_iso

SHORT_PATH = "/uapi/domestic-stock/v1/quotations/daily-short-sale"
CREDIT_PATH = "/uapi/domestic-stock/v1/quotations/daily-credit-balance"


def _num(value, cast=float) -> Optional[float]:
    try:
        if value in (None, ""):
            return None
        return cast(str(value).replace(",", ""))
    except Exception:
        return None


def _kis_get(app_key: str, app_secret: str, token: str, path: str, tr_id: str, params: dict) -> Optional[dict]:
    try:
        r = requests.get(
            KIS_BASE + path,
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {token}",
                "appkey": app_key,
                "appsecret": app_secret,
                "tr_id": tr_id,
                "custtype": "P",
            },
            params=params,
            timeout=10,
        )
        body = r.json()
        return body if body.get("rt_cd") == "0" else None
    except Exception:
        return None


def parse_short_sale(body: Optional[dict]) -> dict:
    """{YYYYMMDD: short_volume(주)}"""
    out: dict = {}
    for row in (body or {}).get("output2") or []:
        d = str(row.get("stck_bsop_date") or "")
        v = _num(row.get("ssts_cntg_qty"), lambda x: int(float(x)))
        if len(d) == 8 and v is not None:
            out[d] = v
    return out


def parse_credit_balance(body: Optional[dict]) -> dict:
    """{YYYYMMDD(매매일): 신용잔고율 %}"""
    out: dict = {}
    for row in (body or {}).get("output") or []:
        d = str(row.get("deal_date") or "")
        v = _num(row.get("whol_loan_rmnd_rate"))
        if len(d) == 8 and v is not None:
            out[d] = v
    return out


def merge_row(existing: Optional[dict], code: str, date_iso: str, short_volume: Optional[int], credit_ratio: Optional[float]) -> Optional[dict]:
    """
    KIS 값을 기존 행에 병합한다. 기존의 비어 있지 않은 값(KRX 공매도 잔고 등)은 지우지 않고,
    이미 ok인 행은 건드리지 않는다(None 반환). upsert가 빠진 키를 NULL로 덮지 않게 모든 키를 채워 보낸다.
    """
    ex = existing or {}
    if ex.get("collection_status") == "ok":
        return None
    if short_volume is None and credit_ratio is None:
        return None
    has_balance = ex.get("short_balance") is not None and ex.get("balance_status") == "ok"
    return {
        "code": code,
        "date": date_iso,
        "credit_ratio": credit_ratio if credit_ratio is not None else ex.get("credit_ratio"),
        "short_ratio": ex.get("short_ratio"),
        "short_balance": ex.get("short_balance"),
        "short_volume": short_volume if short_volume is not None else ex.get("short_volume"),
        "collection_status": "partial",
        "missing_reason": None if has_balance else "balance_krx_only",
        "volume_status": "ok" if short_volume is not None else ex.get("volume_status"),
        "balance_status": ex.get("balance_status") or "unavailable",
    }


def fill_with_kis(supabase: Client, start_yyyymmdd: str, end_yyyymmdd: str, codes: list, trading_dates: list, sleep_sec: float = 0.15) -> dict:
    """
    codes 종목의 [start, end] 신용/공매도를 KIS로 채운다. trading_dates(YYYYMMDD)에 해당하는 날만 저장한다.
    종목당 요청 2건(기간 조회라 거래일 수와 무관). 실패는 건너뛰고 건수만 센다.
    """
    app_key = os.environ.get("KOREA_APP_KEY", "")
    app_secret = os.environ.get("KOREA_APP_SECRET", "")
    if not app_key or not app_secret:
        print("  [KIS 보조] KOREA_APP_KEY/SECRET 없음 → 건너뜀")
        return {"filled": 0, "fail": 0}
    token = _get_kis_token(app_key, app_secret)
    if not token:
        print("  [KIS 보조] 토큰 발급 실패 → 건너뜀")
        return {"filled": 0, "fail": 0}

    iso_dates = [to_iso(d) for d in trading_dates]
    existing_by_key: dict = {}
    try:
        for off in range(0, 20000, 1000):
            res = (
                supabase.table("stock_credit_short_daily")
                .select("code,date,credit_ratio,short_ratio,short_balance,short_volume,collection_status,volume_status,balance_status")
                .in_("date", iso_dates)
                .range(off, off + 999)
                .execute()
            )
            for r in res.data or []:
                existing_by_key[(r["code"], str(r["date"])[:10])] = r
            if len(res.data or []) < 1000:
                break
    except Exception as e:
        print(f"  [KIS 보조] 기존 행 조회 실패(병합 불가) → 건너뜀: {e}")
        return {"filled": 0, "fail": 0}

    rows: list = []
    fail = 0
    for idx, code in enumerate(codes):
        # 이미 모든 대상 날짜가 ok면 요청하지 않는다
        if all((existing_by_key.get((code, d)) or {}).get("collection_status") == "ok" for d in iso_dates):
            continue
        short_body = _kis_get(app_key, app_secret, token, SHORT_PATH, "FHPST04830000", {
            "FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code,
            "FID_INPUT_DATE_1": start_yyyymmdd, "FID_INPUT_DATE_2": end_yyyymmdd,
        })
        credit_body = _kis_get(app_key, app_secret, token, CREDIT_PATH, "FHPST04760000", {
            "FID_COND_MRKT_DIV_CODE": "J", "FID_COND_SCR_DIV_CODE": "20476",
            "FID_INPUT_ISCD": code, "FID_INPUT_DATE_1": end_yyyymmdd,
        })
        if short_body is None and credit_body is None:
            fail += 1
        shorts = parse_short_sale(short_body)
        credits = parse_credit_balance(credit_body)
        for d in trading_dates:
            row = merge_row(existing_by_key.get((code, to_iso(d))), code, to_iso(d), shorts.get(d), credits.get(d))
            if row:
                rows.append(row)
        if (idx + 1) % 50 == 0:
            print(f"  [KIS 보조] 진행 {idx + 1}/{len(codes)} (저장 대기 {len(rows)}행, 실패 {fail})")
        time.sleep(sleep_sec)

    for i in range(0, len(rows), 500):
        supabase.table("stock_credit_short_daily").upsert(rows[i:i + 500], on_conflict="code,date").execute()
    print(f"  [KIS 보조] 저장 {len(rows)}행, 요청 실패 {fail}종목")
    return {"filled": len(rows), "fail": fail}
