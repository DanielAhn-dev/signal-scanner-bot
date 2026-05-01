-- UI API performance indexes
-- Safe guards: only create indexes when target tables exist.

DO $$
BEGIN
  IF to_regclass('public.virtual_positions') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_virtual_positions_created_at_desc ON public.virtual_positions (created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_virtual_positions_code ON public.virtual_positions (code)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_virtual_positions_quantity ON public.virtual_positions (quantity)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_virtual_positions_status ON public.virtual_positions (status)';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.virtual_trade_lots') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_virtual_trade_lots_position_id ON public.virtual_trade_lots (position_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_virtual_trade_lots_position_id_acquired_at ON public.virtual_trade_lots (position_id, acquired_at DESC)';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.virtual_decision_logs') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_virtual_decision_logs_created_at_desc ON public.virtual_decision_logs (created_at DESC)';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.scan_run_logs') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scan_run_logs_created_at_desc ON public.scan_run_logs (created_at DESC)';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.stocks') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_stocks_sector_id ON public.stocks (sector_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_stocks_code ON public.stocks (code)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_stocks_updated_at_desc ON public.stocks (updated_at DESC)';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.pullback_signals') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pullback_signals_trade_date ON public.pullback_signals (trade_date DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pullback_signals_trade_date_entry_warn ON public.pullback_signals (trade_date DESC, entry_grade, warn_grade)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pullback_signals_trade_date_entry_score_desc ON public.pullback_signals (trade_date DESC, entry_score DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pullback_signals_code ON public.pullback_signals (code)';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.daily_indicators') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_daily_indicators_trade_date_code ON public.daily_indicators (trade_date, code)';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.indicators') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_indicators_trade_date_code ON public.indicators (trade_date, code)';
  END IF;
END
$$;
