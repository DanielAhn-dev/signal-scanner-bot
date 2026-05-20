"""
batch_modules/investor.py
========================
STEP 2.5: ??? ?? ??? ??
"""

import os
import time
import requests
import pandas as pd
from io import StringIO
import datetime as dt_module
from typing import Optional, Tuple, Dict, List
from supabase import Client
from pykrx import stock
from .utils import safe_int, to_iso


def fetch_investor_data(supabase: Client, trading_date: str):
    """Collect investor flow data with multi-strategy fallback."""
    trading_iso = to_iso(trading_date)
    print(f"\n[2.5/7] Collecting investor flow data...")

    if os.environ.get("DISABLE_INVESTOR_FETCH", "false").lower() in ("1", "true", "yes"):
        print("  DISABLE_INVESTOR_FETCH=true, skipping investor fetch.")
        return
    
    def _upsert_investor_rows(rows: List[dict]) -> None:
        for i in range(0, len(rows), 500):
            batch = rows[i:i + 500]
            try:
                supabase.table("investor_daily").upsert(batch).execute()
            except Exception as e:
                print(f"     investor_daily upsert error: {e}")
                for j in range(0, len(batch), 50):
                    try:
                        supabase.table("investor_daily").upsert(batch[j:j + 50]).execute()
                    except Exception:
                        pass

    def _collect_by_investor_value(stock_module, code_list: List[str]) -> Tuple[List[dict], int, int]:
        """Primary strategy: get_market_trading_value_by_investor."""
        rows: List[dict] = []
        fail_count = 0
        success_count = 0
        for idx, code in enumerate(code_list):
            if idx % 100 == 0 and idx > 0:
                print(f"  -> [value_by_investor] progress: {idx}/{len(code_list)} (success: {success_count}, fail: {fail_count})")

            try:
                df = stock_module.get_market_trading_value_by_investor(trading_date, trading_date, code)
                if df is None or df.empty:
                    continue

                inst_val = 0
                foreign_val = 0
                for _, row in df.iterrows():
                    inst_val += safe_int(row.get("기관합계", 0))
                    foreign_val += safe_int(row.get("외국인합계", 0))

                if inst_val == 0 and foreign_val == 0:
                    continue

                rows.append({
                    "date": trading_iso,
                    "ticker": code,
                    "institution": inst_val,
                    "foreign": foreign_val,
                })
                success_count += 1
                time.sleep(0.05)
            except Exception:
                fail_count += 1
                continue

        return rows, success_count, fail_count

    def _collect_by_net_purchases(stock_module, code_list: List[str]) -> Tuple[List[dict], int, int]:
        """Fallback 1: net purchases by ticker."""
        try:
            df_inst = stock_module.get_market_net_purchases_of_equities_by_ticker(trading_date, trading_date, "ALL", "기관합계")
            time.sleep(0.05)
            df_foreign = stock_module.get_market_net_purchases_of_equities_by_ticker(trading_date, trading_date, "ALL", "외국인합계")
        except Exception:
            return [], 0, 0

        if df_inst is None or df_foreign is None or df_inst.empty or df_foreign.empty:
            return [], 0, 0

        inst = df_inst.reset_index().rename(columns={
            "티커": "ticker",
            "순매수거래대금": "institution",
            "순매수거래대금(원)": "institution",
        })
        foreign = df_foreign.reset_index().rename(columns={
            "티커": "ticker",
            "순매수거래대금": "foreign",
            "순매수거래대금(원)": "foreign",
        })

        merged = inst[["ticker", "institution"]].merge(
            foreign[["ticker", "foreign"]],
            on="ticker",
            how="inner",
        )

        code_set = set(code_list)
        rows: List[dict] = []
        for _, row in merged.iterrows():
            code = str(row.get("ticker") or "").strip().zfill(6)
            if not code or code not in code_set:
                continue
            inst_val = safe_int(row.get("institution", 0))
            foreign_val = safe_int(row.get("foreign", 0))
            if inst_val == 0 and foreign_val == 0:
                continue
            rows.append({
                "date": trading_iso,
                "ticker": code,
                "institution": inst_val,
                "foreign": foreign_val,
            })

        return rows, len(rows), 0

    def _collect_from_naver_finance(code_list: List[str]) -> Tuple[List[dict], int, int]:
        """Fallback 2: Naver Finance HTML scraping."""
        session = requests.Session()
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Referer": "https://finance.naver.com/",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        })

        target_dt = dt_module.datetime.strptime(trading_date, "%Y%m%d").date()

        def _parse_signed_int(v) -> int:
            s = str(v or "").strip()
            if not s or s.lower() == "nan":
                return 0
            s = s.replace(",", "").replace("\u2212", "-")
            s = "".join(ch for ch in s if ch.isdigit() or ch in ("-", "+"))
            if not s or s in ("-", "+"):
                return 0
            try:
                return int(s)
            except Exception:
                return 0

        def _extract_from_table(df: pd.DataFrame) -> Optional[Tuple[str, int, int]]:
            if df is None or df.empty:
                return None

            temp = df.copy()
            if isinstance(temp.columns, pd.MultiIndex):
                flat_cols = []
                for c in temp.columns:
                    if isinstance(c, tuple):
                        flat = " ".join(str(x) for x in c if str(x) != "nan").strip()
                    else:
                        flat = str(c)
                    flat_cols.append(flat)
                temp.columns = flat_cols
            else:
                temp.columns = [str(c).strip() for c in temp.columns]

            date_col = next((c for c in temp.columns if "날짜" in c), None)
            inst_col = next((c for c in temp.columns if "기관" in c and "순매" in c), None)
            foreign_col = next((c for c in temp.columns if "외국인" in c and "순매" in c), None)

            if not date_col or not inst_col or not foreign_col:
                return None

            working = temp[[date_col, inst_col, foreign_col]].copy()
            working = working.dropna(subset=[date_col])
            if working.empty:
                return None

            best: Optional[Tuple[dt_module.date, int, int]] = None
            for _, row in working.iterrows():
                raw_date = str(row.get(date_col) or "").strip()
                if not raw_date or raw_date.lower() == "nan":
                    continue
                try:
                    row_dt = dt_module.datetime.strptime(raw_date.replace(".", "-").replace(" ", ""), "%Y-%m-%d").date()
                except Exception:
                    continue
                if row_dt > target_dt:
                    continue

                inst_val = _parse_signed_int(row.get(inst_col))
                foreign_val = _parse_signed_int(row.get(foreign_col))

                if best is None or row_dt > best[0]:
                    best = (row_dt, inst_val, foreign_val)

            if best is None:
                return None
            return best[0].isoformat(), best[1], best[2]

        rows: List[dict] = []
        success_count = 0
        fail_count = 0
        for idx, code in enumerate(code_list):
            if idx % 100 == 0 and idx > 0:
                print(f"  -> [naver_finance] progress: {idx}/{len(code_list)} (success: {success_count}, fail: {fail_count})")
            try:
                url = f"https://finance.naver.com/item/frgn.naver?code={code}&page=1"
                resp = session.get(url, timeout=8)
                resp.raise_for_status()
                tables = pd.read_html(StringIO(resp.text))

                picked: Optional[Tuple[str, int, int]] = None
                for tbl in tables:
                    picked = _extract_from_table(tbl)
                    if picked:
                        break

                if not picked:
                    fail_count += 1
                    continue

                matched_date, inst_val, foreign_val = picked
                if inst_val == 0 and foreign_val == 0:
                    fail_count += 1
                    continue

                rows.append({
                    "date": matched_date,
                    "ticker": code,
                    "institution": inst_val,
                    "foreign": foreign_val,
                })
                success_count += 1
                time.sleep(0.04)
            except Exception:
                fail_count += 1
                continue

        return rows, success_count, fail_count

    try:
        res = supabase.table("stocks") \
            .select("code") \
            .in_("universe_level", ["core", "extended"]) \
            .eq("is_active", True).execute()
        codes = [r["code"] for r in (res.data or [])]
        if not codes:
            print("   No active stocks found.")
            return

        print(f"  universe size: {len(codes)} tickers")

        # Strategy 1
        inv_rows, success_count, fail_count = _collect_by_investor_value(stock, codes)
        strategy_used = "value_by_investor"

        # Strategy 2 fallback
        if not inv_rows:
            alt_rows, alt_success, _ = _collect_by_net_purchases(stock, codes)
            if alt_rows:
                inv_rows = alt_rows
                success_count = alt_success
                fail_count = 0
                strategy_used = "net_purchases_by_ticker"

        # Strategy 3 fallback
        if not inv_rows:
            nav_rows, nav_success, nav_fail = _collect_from_naver_finance(codes)
            if nav_rows:
                inv_rows = nav_rows
                success_count = nav_success
                fail_count = nav_fail
                strategy_used = "naver_finance_html"

        if inv_rows:
            _upsert_investor_rows(inv_rows)
            print(f"   stored {len(inv_rows)} investor rows (strategy: {strategy_used}, success: {success_count}, fail: {fail_count})")
            return

        latest = supabase.table("investor_daily").select("date").order("date", desc=True).limit(1).execute()
        latest_date = (latest.data or [{}])[0].get("date") if latest.data else None
        if latest_date:
            from datetime import datetime
            trading_dt = dt_module.datetime.strptime(trading_date, "%Y%m%d").date()
            gap = (trading_dt - datetime.fromisoformat(str(latest_date)).date()).days
            print(f"  investor_daily update unavailable after 3 strategies (latest={latest_date}, stale={gap}d)")
        else:
            print("  investor_daily update unavailable after 3 strategies (no prior data)")

    except Exception as e:
        print(f"  investor data collection failed: {e}")
        import traceback
        traceback.print_exc()



