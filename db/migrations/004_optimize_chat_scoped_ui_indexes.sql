-- Chat-scoped UI API performance indexes
-- Focused on summary/decisions endpoints that filter by chat_id and sort by created_at.

DO $$
BEGIN
  IF to_regclass('public.virtual_positions') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_virtual_positions_chat_id ON public.virtual_positions (chat_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_virtual_positions_chat_id_quantity ON public.virtual_positions (chat_id, quantity)';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.virtual_decision_logs') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_virtual_decision_logs_chat_id ON public.virtual_decision_logs (chat_id)';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.scan_run_logs') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scan_run_logs_chat_id_created_at_desc ON public.scan_run_logs (chat_id, created_at DESC)';
  END IF;
END
$$;
