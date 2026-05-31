"""
batch_modules/scores.py
======================
STEP 5: ?? ?? ??
"""

import subprocess
import sys
import os
from datetime import date, timedelta
from supabase import Client
from .utils import safe_float, safe_int, derive_signal, run_python_script


def run_engine_score_sync(asof: str) -> bool:
    """Run score sync via engine command."""
    pnpm_bin = "pnpm.cmd" if os.name == "nt" else "pnpm"
    cmd = [pnpm_bin, "run", "sync:scores", f"--asof={asof}", "--concurrency=6", "--limit=1500"]
    try:
        print("  -> running engine score sync...", " ".join(cmd))
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        if result.stdout:
            lines = [line for line in result.stdout.splitlines() if line.strip()]
            if lines:
                print(f"   {lines[-1]}")
        return True
    except Exception as e:
        print(f"   engine score sync failed, fallback to legacy scoring: {e}")
        return False


def calculate_stock_scores(supabase: Client, trading_date: str):
    """Calculate stock scores (engine first, legacy fallback)."""
    from .utils import to_iso
    asof = to_iso(trading_date)
    print(f"\n[5/7] Calculating stock scores...")

    if run_engine_score_sync(asof):
        print("   engine score sync completed")
        return

    try:
        trading_iso = asof
        
        res = supabase.table("stocks") \
            .select("code, name, sector_id, universe_level, market_cap, close") \
            .in_("universe_level", ["core", "extended"]).execute()
        all_stocks = res.data or []
        if not all_stocks:
            print("   No stocks found")
            return

        codes = [s["code"] for s in all_stocks]
        indicators_map: dict = {}
        for i in range(0, len(codes), 50):
            batch = codes[i:i+50]
            ind_res = supabase.table("daily_indicators") \
                .select("code, close, rsi14, roc14, roc21, sma20, sma50, sma200, volume, value_traded") \
                .in_("code", batch) \
                .eq("trade_date", trading_iso).execute()
            for row in (ind_res.data or []):
                indicators_map[row["code"]] = row

        existing_scores_map: dict = {}
        for i in range(0, len(codes), 200):
            batch = codes[i:i+200]
            old_res = supabase.table("scores") \
                .select("code, value_score, momentum_score, liquidity_score, total_score, score, factors") \
                .eq("asof", asof) \
                .in_("code", batch).execute()
            for row in (old_res.data or []):
                existing_scores_map[row.get("code")] = row

        print(f"  -> indicators loaded for {len(indicators_map)} stocks")

        # 기관/외국인 최근 5일 순매수 합계 로드
        five_days_ago = (date.fromisoformat(trading_iso) - timedelta(days=7)).isoformat()
        investor_map: dict = {}
        try:
            for i in range(0, len(codes), 200):
                batch = codes[i:i+200]
                inv_res = supabase.table("investor_daily") \
                    .select("ticker, institution, foreign") \
                    .in_("ticker", batch) \
                    .gte("date", five_days_ago) \
                    .lte("date", trading_iso).execute()
                for row in (inv_res.data or []):
                    t = row["ticker"]
                    if t not in investor_map:
                        investor_map[t] = {"institution_5d": 0, "foreign_5d": 0}
                    investor_map[t]["institution_5d"] += safe_int(row.get("institution", 0))
                    investor_map[t]["foreign_5d"] += safe_int(row.get("foreign", 0))
            print(f"  -> investor flow loaded for {len(investor_map)} stocks")
        except Exception as e:
            print(f"  -> investor flow load skipped: {e}")

        sec_res = supabase.table("sectors").select("id, score, change_rate").execute()
        sector_score_map = {
            r["id"]: {"score": safe_float(r.get("score")), "change": safe_float(r.get("change_rate"))}
            for r in (sec_res.data or [])
        }

        upserts = []
        for s in all_stocks:
            code = s["code"]
            ind = indicators_map.get(code, {})
            sec_info = sector_score_map.get(s.get("sector_id", ""), {})

            value_score = 50
            if s.get("universe_level") == "core":
                value_score += 15
            elif s.get("universe_level") == "extended":
                value_score += 5

            rsi = safe_float(ind.get("rsi14"), 50)
            roc14 = safe_float(ind.get("roc14"))
            roc21 = safe_float(ind.get("roc21"))
            close_price = safe_float(ind.get("close"), safe_float(s.get("close")))
            sma20 = safe_float(ind.get("sma20"))
            sma50 = safe_float(ind.get("sma50"))
            sma200 = safe_float(ind.get("sma200"))

            inv = investor_map.get(code, {})
            institution_5d = inv.get("institution_5d", 0)
            foreign_5d = inv.get("foreign_5d", 0)

            momentum_score = 30
            if 45 <= rsi <= 65:
                momentum_score += 20
            elif 35 <= rsi <= 70:
                momentum_score += 10
            if roc14 > 0:
                momentum_score += min(15, roc14 * 3)
            if roc21 > 0:
                momentum_score += min(10, roc21 * 2)
            if close_price > 0 and sma20 > 0 and sma50 > 0:
                if close_price > sma20 > sma50:
                    momentum_score += 15
                elif close_price > sma20:
                    momentum_score += 8
            sec_change = sec_info.get("change", 0)
            if sec_change > 0:
                momentum_score += min(10, sec_change * 3)
            # 기관/외국인 5일 순매수 가산 (최대 +12점)
            if institution_5d > 0 and foreign_5d > 0:
                momentum_score += 12  # 쌍끌이 매수
            elif institution_5d > 0:
                momentum_score += 8
            elif foreign_5d > 0:
                momentum_score += 5
            elif institution_5d < 0 and foreign_5d < 0:
                momentum_score -= 8  # 동반 매도
            momentum_score = min(100, max(0, int(momentum_score)))

            value_traded = safe_float(ind.get("value_traded"))
            liquidity_score = 30
            if value_traded > 50_000_000_000:
                liquidity_score = 90
            elif value_traded > 10_000_000_000:
                liquidity_score = 70
            elif value_traded > 1_000_000_000:
                liquidity_score = 50

            total_score = min(100, max(0, int(round(
                value_score * 0.3 + momentum_score * 0.45 + liquidity_score * 0.25
            ))))

            existing_score = existing_scores_map.get(code, {})
            existing_factors = existing_score.get("factors") if isinstance(existing_score.get("factors"), dict) else {}
            merged_factors = dict(existing_factors)
            merged_factors.update({
                "rsi14": round(rsi, 2),
                "roc14": round(roc14, 2),
                "roc21": round(roc21, 2),
                "sector_change": round(sec_change, 2),
                "institution_5d": institution_5d,
                "foreign_5d": foreign_5d,
            })

            upserts.append({
                "code": code, "asof": asof,
                "score": float(total_score),
                "signal": derive_signal(total_score),
                "factors": merged_factors,
                "value_score": int(value_score),
                "momentum_score": int(momentum_score),
                "liquidity_score": int(liquidity_score),
                "total_score": int(total_score),
            })

        if upserts:
            print(f"  -> upserting {len(upserts)} score rows...")
            for i in range(0, len(upserts), 200):
                batch = upserts[i:i+200]
                try:
                    supabase.table("scores").upsert(batch).execute()
                except Exception as e:
                    print(f"   upsert error: {e}")
                    for j in range(0, len(batch), 50):
                        try:
                            supabase.table("scores").upsert(batch[j:j+50]).execute()
                        except:
                            pass
            print(f"   stored {len(upserts)} score rows")
    except Exception as e:
        print(f"  stock score calculation failed: {e}")
        import traceback
        traceback.print_exc()


