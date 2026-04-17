-- 20260418_fix_virtual_trade_lots_watchlist_fk.sql
-- 목적: watchlist_legacy 삭제를 막는 기존 FK를 virtual_positions로 재연결

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'virtual_trade_lots_watchlist_id_fkey'
      AND conrelid = 'public.virtual_trade_lots'::regclass
  ) THEN
    ALTER TABLE public.virtual_trade_lots
      DROP CONSTRAINT virtual_trade_lots_watchlist_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'virtual_trade_lots_watchlist_id_fkey'
      AND conrelid = 'public.virtual_trade_lots'::regclass
  ) THEN
    ALTER TABLE public.virtual_trade_lots
      ADD CONSTRAINT virtual_trade_lots_watchlist_id_fkey
      FOREIGN KEY (watchlist_id) REFERENCES public.virtual_positions(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
