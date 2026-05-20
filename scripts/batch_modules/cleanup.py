"""
batch_modules/cleanup.py
=======================
STEP 7: ??? ??? ??
"""

import os
from datetime import date, timedelta
from supabase import Client
from .utils import safe_int


def cleanup_old_data(supabase: Client):
    """Cleanup old rows according to retention policy."""
    print(f"\n[7/7] Cleaning up old data...")
    
    stock_retention_days = safe_int(os.environ.get("STOCK_DAILY_RETENTION_DAYS", 400), 400)
    stock_retention_days = max(400, stock_retention_days)
    cutoff = (date.today() - timedelta(days=stock_retention_days)).isoformat()
    
    indicators_retention_days = safe_int(os.environ.get("DAILY_INDICATORS_RETENTION_DAYS", 730), 730)
    indicators_retention_days = max(400, indicators_retention_days)
    indicators_cutoff = (date.today() - timedelta(days=indicators_retention_days)).isoformat()
    
    try:
        supabase.table("stock_daily").delete().lt("date", cutoff).execute()
        supabase.table("investor_daily").delete().lt("date", cutoff).execute()
        supabase.table("sector_daily").delete().lt("date", cutoff).execute()
        supabase.table("daily_indicators").delete().lt("trade_date", indicators_cutoff).execute()
        supabase.table("pullback_signals").delete().lt("trade_date", cutoff).execute()
        try:
            jobs_cutoff = (date.today() - timedelta(days=30)).isoformat()
            supabase.table("jobs").delete() \
                .in_("status", ["done", "failed"]) \
                .lt("created_at", jobs_cutoff).execute()
        except:
            pass
        print(f"  -> stock_daily retention: {stock_retention_days}d (cutoff: {cutoff})")
        print(f"  -> daily_indicators retention: {indicators_retention_days}d (cutoff: {indicators_cutoff})")
        print("   cleanup complete")
    except Exception as e:
        print(f"   cleanup failed (non-fatal): {e}")


