-- 20260608_fix_watchlist_horizon_columns.sql
-- 목적: 20260527에서 추가된 horizon_reason 등 컬럼이 watchlist VIEW에 누락된 문제 수정

BEGIN;

DO $$
DECLARE
  watchlist_kind "char";
BEGIN
  SELECT c.relkind
  INTO watchlist_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'watchlist'
  LIMIT 1;

  IF watchlist_kind = 'v' AND to_regclass('public.virtual_positions') IS NOT NULL THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.watchlist AS
      SELECT
        id,
        chat_id,
        code,
        buy_price,
        buy_date,
        memo,
        created_at,
        updated_at,
        quantity,
        invested_amount,
        bucket,
        status,
        broker_name,
        account_name,
        target_horizon,
        horizon_reason,
        macro_context_at_entry,
        news_context_at_entry,
        planned_review_at
      FROM public.virtual_positions
    $view$;

    EXECUTE 'GRANT SELECT ON public.watchlist TO anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist TO service_role';
  END IF;
END $$;

COMMIT;
