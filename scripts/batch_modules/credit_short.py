"""
batch_modules/credit_short.py
============================
STEP 2.6: ???/?? ??? ??
"""

import time
import requests
from datetime import datetime, timedelta
from supabase import Client
from .utils import to_iso


def fetch_credit_short_data(supabase: Client, trading_date: str):
    """??? ???(KRX MDC_OUT API) ??"""
    trading_iso = to_iso(trading_date)
    print(f"\n[2.6/7] ??? ??? ?? (KRX MDC_OUT API)...")

    import os
    if os.environ.get("DISABLE_CREDIT_SHORT_FETCH", "false").lower() in ("1", "true", "yes"):
        print("  DISABLE_CREDIT_SHORT_FETCH=true  ??? ?? ???")
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
            print("  ?? ?? ??")
            return
        print(f"  ??: {len(codes)}? ??")

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

        # ISIN ?? ??
        isin_map = {}
        try:
            r = sess.post(
                krx_api,
                data={"bld": "dbms/comm/finder/finder_stkisu", "mktsel": "ALL", "typeNo": "0", "pagePath": "/contents/MDC/STAT/srt/MDCSTAT300.cmd", "codeNm": ""},
                timeout=30,
            )
            block = r.json().get("block1", [])
            isin_map = {item["short_code"]: item["full_code"] for item in block}
        except Exception as e:
            print(f"  ISIN ?? ??: {e}")

        cs_rows = []
        success_count = 0
        fail_count = 0
        start_d = (datetime.strptime(trading_date, "%Y%m%d") - timedelta(days=7)).strftime("%Y%m%d")
        end_d = trading_date

        for idx, code in enumerate(codes):
            if idx % 50 == 0 and idx > 0:
                print(f"  ??: {idx}/{len(codes)} (??: {success_count}, ??: {fail_count})")

            isin = isin_map.get(code)
            if not isin:
                fail_count += 1
                continue

            short_volume = None
            short_ratio = None
            short_balance = None

            # ??? ??
            try:
                r = sess.post(
                    krx_api,
                    data={"bld": "dbms/MDC_OUT/STAT/srt/MDCSTAT30102_OUT", "isuCd": isin, "strtDd": start_d, "endDd": end_d, "money": "1", "csvxls_isNo": "false"},
                    timeout=10,
                )
                for row in r.json().get("OutBlock_1", []):
                    date_str = row.get("TRD_DD", "").replace("/", "")
                    if date_str == trading_date:
                        short_volume = int(str(row.get("CVSRTSELL_TRDVOL", "0")).replace(",", "") or "0")
                        short_ratio = float(str(row.get("TRDVOL_WT", "0")).replace(",", "") or "0")
                        break
            except Exception:
                pass

            # ??? ??
            try:
                r = sess.post(
                    krx_api,
                    data={"bld": "dbms/MDC_OUT/STAT/srt/MDCSTAT30502_OUT", "isuCd": isin, "strtDd": start_d, "endDd": end_d, "money": "1", "csvxls_isNo": "false"},
                    timeout=10,
                )
                for row in r.json().get("OutBlock_1", []):
                    date_str = row.get("RPT_DUTY_OCCR_DD", "").replace("/", "")
                    if date_str == trading_date:
                        short_balance = int(str(row.get("BAL_QTY", "0")).replace(",", "") or "0")
                        break
            except Exception:
                pass

            if short_volume is not None or short_ratio is not None or short_balance is not None:
                cs_rows.append({
                    "code": code,
                    "date": trading_iso,
                    "credit_ratio": None,
                    "short_ratio": short_ratio,
                    "short_balance": short_balance,
                    "short_volume": short_volume,
                })
                success_count += 1
            else:
                fail_count += 1

            time.sleep(0.05)

        if cs_rows:
            for i in range(0, len(cs_rows), 500):
                batch = cs_rows[i:i + 500]
                try:
                    supabase.table("stock_credit_short_daily").upsert(batch, on_conflict="code,date").execute()
                except Exception as e:
                    print(f"    stock_credit_short_daily upsert ??: {e}")
                    for j in range(0, len(batch), 50):
                        try:
                            supabase.table("stock_credit_short_daily").upsert(batch[j:j + 50], on_conflict="code,date").execute()
                        except Exception:
                            pass

            # stocks ??? ??? ????
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

            print(f"  {len(cs_rows)}? ??? ??? ?? ?? (??: {success_count}? ??, ??: {fail_count}?)")
        else:
            print(f"  ??? ??? ?? (??: {success_count}, ??: {fail_count})")

    except Exception as e:
        print(f"  ??? ?? ??: {e}")
        import traceback
        traceback.print_exc()


