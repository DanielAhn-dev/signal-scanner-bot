"""
batch_modules/sectors.py
=======================
STEP 3-4: ?? ??? ? ?? ??
"""

import pandas as pd
import numpy as np
from datetime import datetime, date, timedelta
from typing import Dict, List
from supabase import Client
from .utils import safe_float, to_iso


def update_sector_data(supabase: Client, trading_date: str):
    """Aggregate sector change rates from constituent stocks."""
    trading_iso = to_iso(trading_date)
    print(f"\n[3/7] Updating sector change rates (constituent based)...")

    try:
        res_stocks = supabase.table("stocks") \
            .select("code, sector_id, close") \
            .not_.is_("sector_id", "null") \
            .eq("is_active", True).execute()
        stock_sector_map = {r["code"]: r["sector_id"] for r in (res_stocks.data or [])}

        dates_res = supabase.table("stock_daily") \
            .select("date") \
            .lte("date", trading_iso) \
            .order("date", desc=True).limit(1).execute()
        if not dates_res.data:
            print("   No stock_daily data found")
            return

        latest = dates_res.data[0]["date"]
        prev_res = supabase.table("stock_daily") \
            .select("date") \
            .lt("date", latest) \
            .order("date", desc=True).limit(1).execute()
        prev_date = prev_res.data[0]["date"] if prev_res.data else None

        if not prev_date:
            print("   Previous trading date not found; cannot compute change")
            return

        print(f"  Change window: {prev_date} -> {latest}")

        today_res = supabase.table("stock_daily") \
            .select("ticker, close").eq("date", latest).execute()
        prev_day_res = supabase.table("stock_daily") \
            .select("ticker, close").eq("date", prev_date).execute()

        today_map = {r["ticker"]: safe_float(r["close"]) for r in (today_res.data or [])}
        prev_map = {r["ticker"]: safe_float(r["close"]) for r in (prev_day_res.data or [])}

        sector_changes: Dict[str, List[float]] = {}
        for ticker in today_map:
            sid = stock_sector_map.get(ticker)
            if not sid or ticker not in prev_map:
                continue
            t_price, p_price = today_map[ticker], prev_map[ticker]
            if p_price > 0:
                change = (t_price - p_price) / p_price * 100
                sector_changes.setdefault(sid, []).append(change)

        res_sectors = supabase.table("sectors") \
            .select("id, name, metrics").execute()

        sector_updates = []
        for sec in (res_sectors.data or []):
            sid = sec["id"]
            sname = sec.get("name", "")
            old_metrics = sec.get("metrics") or {}
            changes = sector_changes.get(sid, [])
            avg_change = sum(changes) / len(changes) if changes else 0.0

            new_metrics = dict(old_metrics)
            new_metrics["stock_count"] = len([t for t, s in stock_sector_map.items() if s == sid])

            sector_updates.append({
                "id": sid,
                "name": sname,
                "avg_change_rate": round(avg_change, 4),
                "change_rate": round(avg_change, 4),
                "metrics": new_metrics,
                "updated_at": datetime.now().isoformat(),
            })

        if sector_updates:
            for i in range(0, len(sector_updates), 100):
                supabase.table("sectors").upsert(sector_updates[i:i+100]).execute()
            print(f"   Updated {len(sector_updates)} sectors")

    except Exception as e:
        print(f"  sector update failed: {e}")
        import traceback
        traceback.print_exc()


def populate_sector_daily(supabase: Client):
    """Populate sector_daily time series."""
    print(f"\n[3.5/7] Populating sector_daily time series...")

    try:
        existing_res = supabase.table("sector_daily") \
            .select("sector_id, date, close, value") \
            .order("date", desc=True).limit(1000).execute()

        last_known: Dict[str, dict] = {}
        for r in (existing_res.data or []):
            sid = r["sector_id"]
            if sid not in last_known:
                last_known[sid] = {"date": r["date"], "close": safe_float(r["close"], 1000), "value": safe_float(r.get("value"), 0)}

        latest_sector_date = max((v["date"] for v in last_known.values()), default="2025-01-01")
        print(f"  latest sector_daily date: {latest_sector_date}")

        stocks_res = supabase.table("stocks") \
            .select("code, sector_id") \
            .not_.is_("sector_id", "null") \
            .eq("is_active", True).execute()
        stock_sector = {r["code"]: r["sector_id"] for r in (stocks_res.data or [])}
        all_sector_ids = set(stock_sector.values())

        ref_ticker = "005930"
        dates_res = supabase.table("stock_daily") \
            .select("date") \
            .eq("ticker", ref_ticker) \
            .gt("date", latest_sector_date) \
            .order("date", desc=False) \
            .limit(500).execute()

        unique_dates = sorted(set(r["date"] for r in (dates_res.data or [])))
        if not unique_dates:
            print("   No new stock_daily dates found; skipping")
            return

        print(f"  dates to process: {len(unique_dates)} ({unique_dates[0]} ~ {unique_dates[-1]})")

        prev_date_data: Dict[str, dict] = {}
        if latest_sector_date > "2025-01-01":
            prev_res = supabase.table("stock_daily") \
                .select("ticker, close") \
                .eq("date", latest_sector_date) \
                .limit(2000).execute()
            for r in (prev_res.data or []):
                prev_date_data[r["ticker"]] = {"close": safe_float(r["close"])}

        upsert_buffer: list = []

        for di, dt in enumerate(unique_dates):
            day_res = supabase.table("stock_daily") \
                .select("ticker, close, value, volume") \
                .eq("date", dt) \
                .limit(2000).execute()
            day_data = {r["ticker"]: {"close": safe_float(r["close"]), "value": safe_float(r.get("value", 0))} for r in (day_res.data or [])}

            if not day_data:
                continue

            sector_agg: Dict[str, Dict] = {}
            for ticker, td in day_data.items():
                sid = stock_sector.get(ticker)
                if not sid:
                    continue
                if sid not in sector_agg:
                    sector_agg[sid] = {"changes": [], "values": []}

                prev = prev_date_data.get(ticker, {}).get("close", 0)
                cur = td["close"]
                if prev > 0 and cur > 0:
                    change_pct = (cur - prev) / prev
                    sector_agg[sid]["changes"].append(change_pct)
                sector_agg[sid]["values"].append(td["value"])

            for sid in all_sector_ids:
                agg = sector_agg.get(sid)
                if not agg or not agg["changes"]:
                    continue

                avg_change = sum(agg["changes"]) / len(agg["changes"])
                total_value = sum(agg["values"])

                prev_close = last_known.get(sid, {}).get("close", 1000.0)
                new_close = round(prev_close * (1 + avg_change), 2)

                upsert_buffer.append({
                    "sector_id": sid,
                    "date": dt,
                    "close": new_close,
                    "value": total_value,
                    "updated_at": datetime.now().isoformat(),
                })

                last_known[sid] = {"date": dt, "close": new_close, "value": total_value}

            prev_date_data = {t: {"close": d["close"]} for t, d in day_data.items()}

            if len(upsert_buffer) >= 500:
                try:
                    supabase.table("sector_daily").upsert(upsert_buffer).execute()
                except Exception as e:
                    print(f"     sector_daily upsert error: {e}")
                upsert_buffer = []

            if (di + 1) % 20 == 0:
                print(f"  -> progress: {di + 1}/{len(unique_dates)}")

        if upsert_buffer:
            try:
                supabase.table("sector_daily").upsert(upsert_buffer).execute()
            except Exception as e:
                print(f"     sector_daily upsert error: {e}")
            print(f"   sector_daily population complete ({len(unique_dates)} dates)")

    except Exception as e:
        print(f"  sector_daily population failed: {e}")
        import traceback
        traceback.print_exc()


def aggregate_sector_investor_flows(supabase: Client, lookback_days: int = 5):
    """investor_daily 최근 N일 합계를 섹터별로 집계 → sectors.metrics 업데이트."""
    print(f"\n[2.8/7] Aggregating sector investor flows (last {lookback_days}d)...")
    try:
        from datetime import date, timedelta
        cutoff = (date.today() - timedelta(days=lookback_days + 3)).isoformat()

        # 최근 investor_daily 로딩
        inv_res = supabase.table("investor_daily") \
            .select("ticker, date, institution_amount, foreign_amount") \
            .gte("date", cutoff) \
            .execute()
        inv_rows = inv_res.data or []
        if not inv_rows:
            print("   investor_daily 데이터 없음, 스킵")
            return

        # 종목 → 섹터 매핑
        stocks_res = supabase.table("stocks") \
            .select("code, sector_id") \
            .not_.is_("sector_id", "null") \
            .eq("is_active", True).execute()
        code_to_sector = {r["code"]: r["sector_id"] for r in (stocks_res.data or [])}

        # 섹터별 최근 N일 수급 합산
        from collections import defaultdict
        sector_inst: dict[str, float] = defaultdict(float)
        sector_frgn: dict[str, float] = defaultdict(float)

        for r in inv_rows:
            sid = code_to_sector.get(r["ticker"])
            if not sid:
                continue
            sector_inst[sid] += float(r.get("institution_amount") or 0)
            sector_frgn[sid] += float(r.get("foreign_amount") or 0)

        if not sector_inst:
            print("   집계 결과 없음, 스킵")
            return

        # sectors.metrics 업데이트
        sectors_res = supabase.table("sectors").select("id, metrics").execute()
        updates = []
        for sec in (sectors_res.data or []):
            sid = sec["id"]
            if sid not in sector_inst and sid not in sector_frgn:
                continue
            metrics = dict(sec.get("metrics") or {})
            metrics["flow_inst_5d"] = int(sector_inst.get(sid, 0))
            metrics["flow_foreign_5d"] = int(sector_frgn.get(sid, 0))
            updates.append({"id": sid, "metrics": metrics})

        for i in range(0, len(updates), 100):
            supabase.table("sectors").upsert(updates[i:i+100]).execute()

        print(f"   {len(updates)}개 섹터 수급 집계 완료")
    except Exception as e:
        print(f"  aggregate_sector_investor_flows failed: {e}")
        import traceback
        traceback.print_exc()


def mark_sector_leaders(supabase: Client, top_n: int = 3):
    """각 섹터 내 시총 상위 top_n 종목을 is_sector_leader=true 로 마킹."""
    print(f"\n[3.8/7] Marking sector leaders (top {top_n} by market_cap per sector)...")
    try:
        stocks_res = supabase.table("stocks") \
            .select("code, sector_id, market_cap, is_sector_leader") \
            .not_.is_("sector_id", "null") \
            .eq("is_active", True) \
            .in_("market", ["KOSPI", "KOSDAQ"]) \
            .execute()
        rows = stocks_res.data or []
        if not rows:
            print("   No stocks found")
            return

        # 섹터별 시총 기준 정렬 → top_n 리더 선정
        from collections import defaultdict
        sector_stocks: dict[str, list] = defaultdict(list)
        for r in rows:
            if r.get("market_cap") is not None:
                sector_stocks[r["sector_id"]].append(r)

        leader_codes: set[str] = set()
        for stocks_in_sector in sector_stocks.values():
            stocks_in_sector.sort(key=lambda x: (x["market_cap"] or 0), reverse=True)
            for r in stocks_in_sector[:top_n]:
                leader_codes.add(r["code"])

        # 변경이 필요한 종목만 업데이트
        updates: list[dict] = []
        for r in rows:
            should_be_leader = r["code"] in leader_codes
            current = r.get("is_sector_leader")
            if current != should_be_leader:
                updates.append({"code": r["code"], "is_sector_leader": should_be_leader})

        if updates:
            # upsert 대신 in_() 필터 update — name 등 NOT NULL 컬럼 불필요
            true_codes  = [r["code"] for r in updates if r["is_sector_leader"]]
            false_codes = [r["code"] for r in updates if not r["is_sector_leader"]]
            batch_size = 200
            for i in range(0, len(true_codes), batch_size):
                supabase.table("stocks") \
                    .update({"is_sector_leader": True}) \
                    .in_("code", true_codes[i:i+batch_size]).execute()
            for i in range(0, len(false_codes), batch_size):
                supabase.table("stocks") \
                    .update({"is_sector_leader": False}) \
                    .in_("code", false_codes[i:i+batch_size]).execute()
            print(f"   Updated is_sector_leader for {len(updates)} stocks ({len(leader_codes)} leaders across {len(sector_stocks)} sectors)")
        else:
            print("   No changes needed")
    except Exception as e:
        print(f"  mark_sector_leaders failed: {e}")
        import traceback
        traceback.print_exc()


def calculate_sector_scores(supabase: Client):
    """Calculate sector scores from flow/momentum/series factors."""
    print(f"\n[4/7] Calculating sector scores...")
    try:
        res = supabase.table("sectors") \
            .select("id, name, change_rate, avg_change_rate, metrics").execute()
        sectors = res.data or []
        if not sectors:
            print("   No sectors found")
            return

        from_date = (date.today() - timedelta(days=90)).isoformat()
        sd_res = supabase.table("sector_daily") \
            .select("sector_id, date, close, value") \
            .gte("date", from_date) \
            .order("date", desc=False).execute()
        sd_df = pd.DataFrame(sd_res.data or [])

        updates = []
        nan_count = 0
        for sec in sectors:
            sid = sec["id"]
            sname = sec.get("name", "")
            metrics = sec.get("metrics") or {}
            change_rate = safe_float(sec.get("change_rate"), 0)

            flow_f = safe_float(metrics.get("flow_foreign_5d", 0), 0)
            flow_i = safe_float(metrics.get("flow_inst_5d", 0), 0)
            flow_total = (flow_f + flow_i) / 1e8
            flow_score = min(30, max(0, safe_float(flow_total * 0.5, 0)))

            momentum_score = min(40, max(0, safe_float((change_rate + 3) * 6.67, 0)))

            series_score = 15
            if not sd_df.empty:
                sec_series = sd_df[sd_df["sector_id"] == sid].sort_values("date")
                if len(sec_series) >= 5:
                    closes = sec_series["close"].astype(float).tolist()
                    if len(closes) >= 5 and closes[-5] > 0 and closes[-1] > 0:
                        ret_5d = (closes[-1] - closes[-5]) / closes[-5]
                        if np.isfinite(ret_5d):
                            series_score = min(30, max(0, safe_float((ret_5d + 0.05) * 300, 15)))
                    if len(closes) >= 20 and closes[-20] > 0 and closes[-1] > 0:
                        ret_20d = (closes[-1] - closes[-20]) / closes[-20]
                        if np.isfinite(ret_20d) and ret_20d > 0:
                            series_score = min(30, series_score + safe_float(5 * min(1, ret_20d), 0))

            total_score = int(round(safe_float(flow_score + momentum_score + series_score, 50)))
            total_score = min(100, max(0, total_score))
            
            if pd.isna(total_score) or not np.isfinite(total_score):
                nan_count += 1
                total_score = 50
            
            updates.append({
                "id": sid, "name": sname, "score": total_score,
                "updated_at": datetime.now().isoformat(),
            })

        if updates:
            for i in range(0, len(updates), 100):
                supabase.table("sectors").upsert(updates[i:i+100]).execute()
            msg = f"   Updated scores for {len(updates)} sectors"
            if nan_count > 0:
                msg += f" (NaN fallback: {nan_count})"
            print(msg)
    except Exception as e:
        print(f"  sector score calculation failed: {e}")
        import traceback
        traceback.print_exc()


