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
    auto_backfill_done = auto_backfill_missing_dates(supabase, trading_date)
    
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

    if market_ok:
        time.sleep(1)
        
        # Step 2: Technical indicators
        print("\n[2/7] Calculating indicators...")
        step_start = time.time()
        calculate_indicators(supabase, trading_date)
        stage_times["Indicators"] = time.time() - step_start
        print(f"   Completed in {stage_times['Indicators']:.1f}s")
        
        time.sleep(1)
        
        # Step 2.5: Investor flow data
        print("\n[2.5/7] Collecting investor data...")
        step_start = time.time()
        fetch_investor_data(supabase, trading_date)
        stage_times["InvestorData"] = time.time() - step_start
        print(f"   Completed in {stage_times['InvestorData']:.1f}s")
        
        time.sleep(1)
        
        # Step 2.6: Credit/short-selling data
        print("\n[2.6/7] Collecting credit/short data...")
        step_start = time.time()
        fetch_credit_short_data(supabase, trading_date)
        stage_times["CreditShortData"] = time.time() - step_start
        print(f"   Completed in {stage_times['CreditShortData']:.1f}s")
        
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

        step_start = time.time()
        mark_sector_leaders(supabase)
        print(f"   Completed in {time.time() - step_start:.1f}s")

        time.sleep(1)

        # Step 5: Stock scores
        print("\n[5/7] Calculating stock scores...")
        step_start = time.time()
        calculate_stock_scores(supabase, trading_date)
        stage_times["StockScores"] = time.time() - step_start
        print(f"   Completed in {stage_times['StockScores']:.1f}s")
        
        time.sleep(1)
        
        # Step 6: Pullback signals
        print("\n[6/7] Generating pullback signals...")
        step_start = time.time()
        save_pullback_signals(supabase, trading_date)
        stage_times["PullbackSignals"] = time.time() - step_start
        print(f"   Completed in {stage_times['PullbackSignals']:.1f}s")
        
        time.sleep(0.5)
    else:
        print("\n[WARN] Market data not available, skipping downstream steps")
        print("\n[INFO] Troubleshooting:")
        print("   1. Check pykrx API status (Naver Finance may be blocked)")
        print("   2. Explicitly specify trading date: --date 20260515")
        print("   3. Reinit DB and retry: --reset-stock-data --date 20260515")

    # Step 7: Cleanup
    print("\n[7/7] Cleaning up old data...")
    step_start = time.time()
    cleanup_old_data(supabase)
    print(f"   Completed in {time.time() - step_start:.1f}s")
    stage_times["Cleanup"] = time.time() - step_start

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

    print(f"\n[END] Daily Batch End: {datetime.now().isoformat()}")
    return 0


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
