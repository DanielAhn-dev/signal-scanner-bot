#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/daily_batch.py - Daily batch processor

Orchestrates data collection, processing, and cleanup operations.

Steps:
  0. Auto-backfill missing trading dates
  1. Collect OHLCV data (stock_daily table)
  2. Calculate technical indicators (daily_indicators table)
  2.5. Collect investor flow data
  2.6. Collect credit/short-selling data
  3-4. Update sector performance and scoring
  5. Calculate stock scores and signals
  6. Generate pullback trading signals
  7. Cleanup old data per retention policy

Environment variables:
  SUPABASE_URL                      - Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY         - Supabase service role API key
  DAILY_INDICATORS_RETENTION_DAYS   - Retention days for daily_indicators (default: 400)
"""

import os
import sys
import time
import json
import uuid
import subprocess
import urllib.request
from datetime import datetime
from pathlib import Path

# Add scripts directory to path for batch_modules imports
sys.path.insert(0, str(Path(__file__).parent))

# Import all batch modules
from batch_modules.utils import load_env_file, get_last_trading_date
from batch_modules.backfill import auto_backfill_missing_dates
from batch_modules.ohlcv import fetch_ohlcv_per_ticker
from batch_modules.indicators import calculate_indicators
from batch_modules.investor import fetch_investor_data
from batch_modules.credit_short import fetch_credit_short_data
from batch_modules.sectors import update_sector_data, populate_sector_daily, calculate_sector_scores, mark_sector_leaders, aggregate_sector_investor_flows
from batch_modules.scores import calculate_stock_scores
from batch_modules.signals import save_pullback_signals
from batch_modules.cleanup import cleanup_old_data


def send_telegram_alert(text: str) -> bool:
    """배치 장애 발생 시 텔레그램으로 관리자 알림 전송."""
    token = str(os.environ.get("TELEGRAM_BOT_TOKEN", "")).strip()
    chat_id = (
        str(os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "")).strip()
        or str(os.environ.get("AUTO_TRADE_ALERT_CHAT_ID", "")).strip()
    )
    if not token or not chat_id:
        return False
    try:
        data = json.dumps({
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": True,
        }).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"[WARN] Telegram alert failed: {e}")
        return False


def sync_scan_signal_history_for_date(trading_date: str) -> bool:
    """Sync scan_signal_history for the processed trading date."""
    trade_iso = f"{trading_date[:4]}-{trading_date[4:6]}-{trading_date[6:8]}"
    pnpm_bin = "pnpm.cmd" if os.name == "nt" else "pnpm"
    cmd = [
        pnpm_bin,
        "-s",
        "tsx",
        "scripts/backfill_scan_signal_history.ts",
        f"--from={trade_iso}",
        f"--to={trade_iso}",
        "--limitDates=7",
    ]
    print("\n[6.1/7] Syncing scan signal history...")
    print(f"  -> {' '.join(cmd)}")
    try:
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        out = (result.stdout or "").strip().splitlines()
        if out:
            print(f"   {out[-1]}")
        return True
    except Exception as e:
        print(f"  [WARN] scan signal history sync skipped: {e}")
        return False


def refresh_universe_membership_for_date(trading_date: str) -> bool:
    """Refresh universe membership before downstream batch stages."""
    cmd = [
        sys.executable,
        "scripts/refresh_universe_membership.py",
        "--date",
        trading_date,
    ]
    print("\n[-1/7] Refreshing universe membership...")
    print(f"  -> {' '.join(cmd)}")
    try:
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        out = (result.stdout or "").strip().splitlines()
        if out:
            print(f"   {out[-1]}")
        return True
    except Exception as e:
        print(f"  [WARN] universe refresh failed: {e}")
        return False


def _status_paths() -> tuple[Path, Path]:
    base = Path(__file__).resolve().parents[1] / "logs"
    return base / "daily_batch_status.json", base / "daily_batch_history.ndjson"


def _write_batch_status(snapshot: dict):
    status_path, history_path = _status_paths()
    status_path.parent.mkdir(parents=True, exist_ok=True)
    with status_path.open("w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)
    with history_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(snapshot, ensure_ascii=False) + "\n")


def main():
    """Main batch processor entry point"""
    
    # Load environment configuration
    print("[DEBUG] Loading environment...", flush=True)
    load_env_file()
    print("[DEBUG] Environment loaded", flush=True)
    
    # Initialize Supabase client
    print("[DEBUG] Initializing Supabase...", flush=True)
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if not supabase_url or not supabase_key:
        print("[ERROR] SUPABASE_URL or SERVICE_ROLE_KEY missing", file=sys.stderr)
        sys.exit(1)
    
    from supabase import create_client
    print("[DEBUG] Creating Supabase client...", flush=True)
    supabase = create_client(supabase_url, supabase_key)
    print("[DEBUG] Supabase client initialized", flush=True)
    sys.stdout.flush()
    
    print(f"[START] Daily Batch Start: {datetime.now().isoformat()}", flush=True)
    sys.stdout.flush()
    print(f"   Using individual API mode (KRX batch API unavailable)", flush=True)
    print(f"\n   Options:", flush=True)
    print(f"      --date YYYYMMDD      : Specify trading date (e.g., --date 20260515)", flush=True)
    print(f"      --skip-ohlcv         : Skip OHLCV collection (start from indicators)", flush=True)
    print(f"      --reset-stock-data   : Reinitialize stock_daily table", flush=True)

    # Parse command-line arguments
    skip_ohlcv = "--skip-ohlcv" in sys.argv
    reset_stock_data = "--reset-stock-data" in sys.argv
    require_investor_data = os.environ.get("BATCH_REQUIRE_INVESTOR_DATA", "false").lower() in ("1", "true", "yes")
    require_score_sync = os.environ.get("BATCH_REQUIRE_SCORE_SYNC", "true").lower() in ("1", "true", "yes")
    require_engine_score = os.environ.get("BATCH_REQUIRE_ENGINE_SCORE", "false").lower() in ("1", "true", "yes")
    auto_refresh_universe = os.environ.get("BATCH_AUTO_REFRESH_UNIVERSE", "false").lower() in ("1", "true", "yes")
    require_universe_refresh = os.environ.get("BATCH_REQUIRE_UNIVERSE_REFRESH", "false").lower() in ("1", "true", "yes")
    investor_max_stale_business_days = int(os.environ.get("INVESTOR_MAX_STALE_BUSINESS_DAYS", "1"))

    run_id = f"daily-batch-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    run_started_at = datetime.now().isoformat()
    run_status = {
        "run_id": run_id,
        "started_at": run_started_at,
        "finished_at": None,
        "status": "running",
        "processed_date": None,
        "reason": "",
        "duration_seconds": None,
        "config": {
            "skip_ohlcv": skip_ohlcv,
            "reset_stock_data": reset_stock_data,
            "require_investor_data": require_investor_data,
            "require_score_sync": require_score_sync,
            "require_engine_score": require_engine_score,
            "auto_refresh_universe": auto_refresh_universe,
            "require_universe_refresh": require_universe_refresh,
            "investor_max_stale_business_days": investor_max_stale_business_days,
        },
        "stages": {},
        "summary": {},
    }
    finalized = False

    def mark_stage(stage: str, ok: bool, elapsed_sec: float, detail: dict | None = None):
        run_status["stages"][stage] = {
            "ok": bool(ok),
            "elapsed_seconds": round(float(elapsed_sec), 3),
            "detail": detail or {},
        }

    def finalize(status: str, reason: str = "", code: int = 0):
        nonlocal finalized
        if finalized:
            return code
        finished_at = datetime.now().isoformat()
        run_status["finished_at"] = finished_at
        run_status["status"] = status
        run_status["reason"] = reason
        run_status["processed_date"] = run_status.get("processed_date")
        started = datetime.fromisoformat(run_started_at)
        finished = datetime.fromisoformat(finished_at)
        run_status["duration_seconds"] = round((finished - started).total_seconds(), 3)
        _write_batch_status(run_status)
        finalized = True
        return code
    
    # Determine trading date
    if "--date" in sys.argv:
        date_idx = sys.argv.index("--date")
        if date_idx + 1 < len(sys.argv):
            trading_date = sys.argv[date_idx + 1]
            print(f"   Trading date (explicit): {trading_date}", flush=True)
        else:
            print("[WARN] --date argument missing, auto-detecting")
            trading_date = get_last_trading_date()
            print(f"   Trading date (auto-detected): {trading_date}", flush=True)
    else:
        trading_date = get_last_trading_date()
        print(f"   Trading date (auto-detected): {trading_date}", flush=True)
    run_status["processed_date"] = trading_date

    # Optional universe automation
    if auto_refresh_universe:
        step_start = time.time()
        universe_ok = refresh_universe_membership_for_date(trading_date)
        elapsed = time.time() - step_start
        stage_times["UniverseRefresh"] = elapsed
        mark_stage("UniverseRefresh", bool(universe_ok), elapsed, {"trading_date": trading_date})
        if not universe_ok and require_universe_refresh:
            print("[ERROR] BATCH_REQUIRE_UNIVERSE_REFRESH=true and universe refresh failed")
            return finalize("failed", "universe_refresh_failed", 5)

    # Reset stock_daily if requested
    if reset_stock_data:
        print(f"\n[RESET] --reset-stock-data flag detected")
        try:
            supabase.table("stock_daily").delete().gte("date", "2000-01-01").execute()
            print(f"[OK] stock_daily table reinitialized")
        except Exception as e:
            print(f"[WARN] Reinitialization failed: {e}")

    # Track execution times
    stage_times = {}
    start_time = time.time()

    # Step 0: Auto-backfill missing dates
    print(f"\n[0/7] Auto-backfill missing dates...")
    step_start = time.time()
    auto_backfill_done = auto_backfill_missing_dates(supabase, trading_date)
    mark_stage("AutoBackfill", True, time.time() - step_start, {"auto_backfill_done": bool(auto_backfill_done)})
    
    # Step 1: OHLCV collection (skip if auto-backfill already done or --skip-ohlcv)
    if skip_ohlcv or auto_backfill_done:
        if auto_backfill_done:
            print("\n[1/7] OHLCV collection skipped (auto-backfill completed)")
        else:
            print("\n[1/7] OHLCV collection skipped (--skip-ohlcv flag)")
        market_ok = True
    else:
        print("\n[1/7] OHLCV collection starting...")
        step_start = time.time()
        market_ok = fetch_ohlcv_per_ticker(supabase, trading_date)
        stage_times["OHLCV"] = time.time() - step_start
        print(f"   Completed in {stage_times['OHLCV']:.1f}s")
        mark_stage("OHLCV", bool(market_ok), stage_times["OHLCV"])

    if market_ok:
        time.sleep(1)
        
        # Step 2: Technical indicators
        print("\n[2/7] Calculating indicators...")
        step_start = time.time()
        calculate_indicators(supabase, trading_date)
        stage_times["Indicators"] = time.time() - step_start
        print(f"   Completed in {stage_times['Indicators']:.1f}s")
        mark_stage("Indicators", True, stage_times["Indicators"])
        
        time.sleep(1)
        
        # Step 2.5: Investor flow data
        print("\n[2.5/7] Collecting investor data...")
        step_start = time.time()
        investor_status = fetch_investor_data(supabase, trading_date)
        stage_times["InvestorData"] = time.time() - step_start
        print(f"   Completed in {stage_times['InvestorData']:.1f}s")

        investor_stage_ok = bool(investor_status.get("ok"))
        stale_days = investor_status.get("stale_business_days")
        if stale_days is not None and stale_days > investor_max_stale_business_days:
            investor_stage_ok = False
            print(
                "[WARN] Investor freshness gate failed: "
                f"lag={stale_days} business days (max={investor_max_stale_business_days})"
            )

        if not investor_stage_ok:
            reason = investor_status.get("reason") or "unknown"
            stale_info = f" (lag={stale_days}일)" if stale_days is not None else ""
            print(f"[WARN] Investor data quality gate failed: reason={reason}, status={investor_status}")
            mark_stage("InvestorData", False, stage_times["InvestorData"], investor_status)
            alert_msg = (
                f"⚠️ [배치 경보] investor_daily 수집 실패\n"
                f"날짜: {trading_date}\n"
                f"사유: {reason}{stale_info}\n"
                f"영향: 외국인/기관 수급 신호 부정확 → 자동매매 신호 품질 저하\n"
                f"조치: GitHub Actions 로그 확인 필요"
            )
            send_telegram_alert(alert_msg)
            if require_investor_data:
                print("[ERROR] BATCH_REQUIRE_INVESTOR_DATA=true and investor data gate failed")
                return finalize("failed", f"investor_gate_failed:{reason}", 2)
        else:
            mark_stage("InvestorData", True, stage_times["InvestorData"], investor_status)
        
        time.sleep(1)
        
        # Step 2.6: Credit/short-selling data
        print("\n[2.6/7] Collecting credit/short data...")
        step_start = time.time()
        fetch_credit_short_data(supabase, trading_date)
        stage_times["CreditShortData"] = time.time() - step_start
        print(f"   Completed in {stage_times['CreditShortData']:.1f}s")
        mark_stage("CreditShortData", True, stage_times["CreditShortData"])
        
        time.sleep(1)
        
        # Step 3-4: Sector processing
        print("\n[3/7] Updating sector data...")
        step_start = time.time()
        update_sector_data(supabase, trading_date)
        print(f"   Completed in {time.time() - step_start:.1f}s")
        
        time.sleep(0.5)
        
        print("[4/7] Populating sector daily data...")
        step_start = time.time()
        populate_sector_daily(supabase)
        print(f"   Completed in {time.time() - step_start:.1f}s")
        
        time.sleep(0.5)
        
        step_start = time.time()
        aggregate_sector_investor_flows(supabase)
        print(f"   Completed in {time.time() - step_start:.1f}s")

        print("[4.1/7] Calculating sector scores...")
        step_start = time.time()
        calculate_sector_scores(supabase)
        print(f"   Completed in {time.time() - step_start:.1f}s")
        stage_times["SectorData"] = time.time() - step_start
        mark_stage("SectorData", True, stage_times["SectorData"])

        step_start = time.time()
        mark_sector_leaders(supabase)
        print(f"   Completed in {time.time() - step_start:.1f}s")

        time.sleep(1)

        # Step 5: Stock scores
        print("\n[5/7] Calculating stock scores...")
        step_start = time.time()
        score_result = calculate_stock_scores(supabase, trading_date)
        stage_times["StockScores"] = time.time() - step_start
        print(f"   Completed in {stage_times['StockScores']:.1f}s")
        score_ok = bool(score_result.get("ok"))
        score_source = str(score_result.get("source") or "unknown")
        mark_stage("StockScores", score_ok, stage_times["StockScores"], score_result)

        if not score_ok:
            print("[WARN] Stock score stage failed (engine and fallback unavailable)")
            if require_score_sync:
                print("[ERROR] BATCH_REQUIRE_SCORE_SYNC=true and score stage failed")
                return finalize("failed", "score_stage_failed", 3)

        if score_ok and require_engine_score and score_source != "engine":
            print("[ERROR] BATCH_REQUIRE_ENGINE_SCORE=true but engine sync was not used")
            return finalize("failed", f"engine_required_but_used_{score_source}", 4)
        
        time.sleep(1)
        
        # Step 6: Pullback signals
        if score_ok:
            print("\n[6/7] Generating pullback signals...")
            step_start = time.time()
            save_pullback_signals(supabase, trading_date)
            stage_times["PullbackSignals"] = time.time() - step_start
            print(f"   Completed in {stage_times['PullbackSignals']:.1f}s")
            mark_stage("PullbackSignals", True, stage_times["PullbackSignals"])

            step_start = time.time()
            scan_sync_ok = sync_scan_signal_history_for_date(trading_date)
            stage_times["ScanSignalHistorySync"] = time.time() - step_start
            print(f"   Completed in {stage_times['ScanSignalHistorySync']:.1f}s")
            mark_stage("ScanSignalHistorySync", bool(scan_sync_ok), stage_times["ScanSignalHistorySync"])
        else:
            print("\n[6/7] Pullback signals skipped (score stage failed)")
            mark_stage("PullbackSignals", False, 0.0, {"reason": "score_stage_failed"})
        
        time.sleep(0.5)
    else:
        print("\n[WARN] Market data not available, skipping downstream steps")
        print("\n[INFO] Troubleshooting:")
        print("   1. Check pykrx API status (Naver Finance may be blocked)")
        print("   2. Explicitly specify trading date: --date 20260515")
        print("   3. Reinit DB and retry: --reset-stock-data --date 20260515")
        mark_stage("OHLCV", False, stage_times.get("OHLCV", 0.0), {"reason": "market_not_available"})

    # Step 7: Cleanup
    print("\n[7/7] Cleaning up old data...")
    step_start = time.time()
    cleanup_old_data(supabase)
    print(f"   Completed in {time.time() - step_start:.1f}s")
    stage_times["Cleanup"] = time.time() - step_start
    mark_stage("Cleanup", True, stage_times["Cleanup"])

    # Summary
    total_time = time.time() - start_time
    print(f"\n[COMPLETE] Daily batch completed in {total_time:.1f}s")
    print(f"   Date processed: {trading_date}")
    if stage_times:
        print(f"   Stage times:")
        for stage, elapsed in sorted(stage_times.items(), key=lambda x: x[1], reverse=True):
            pct = (elapsed / total_time * 100) if total_time > 0 else 0
            print(f"      {stage}: {elapsed:.1f}s ({pct:.1f}%)")
    
    if total_time > 600:
        print(f"[WARN] Batch took {total_time/60:.1f}min (target: <10min)")

    run_status["summary"] = {
        "total_time_seconds": round(total_time, 3),
        "stage_times": {k: round(v, 3) for k, v in stage_times.items()},
    }

    print(f"\n[END] Daily Batch End: {datetime.now().isoformat()}")
    return finalize("success", "", 0)


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
