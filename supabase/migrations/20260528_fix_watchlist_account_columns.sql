-- 20260528_fix_watchlist_account_columns.sql
-- 목적:
-- 1) 가상매매 코드가 기대하는 broker_name/account_name 컬럼을 정식 스키마에 보장
-- 2) watchlist가 테이블/뷰 어떤 형태여도 호환되도록 정합성 복구

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.virtual_positions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.virtual_positions ADD COLUMN IF NOT EXISTS broker_name text';
    EXECUTE 'ALTER TABLE public.virtual_positions ADD COLUMN IF NOT EXISTS account_name text';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_virtual_positions_chat_broker_account ON public.virtual_positions (chat_id, broker_name, account_name)';
  END IF;
END $$;

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

  IF watchlist_kind = 'r' THEN
    -- legacy table인 경우 컬럼 직접 추가
    EXECUTE 'ALTER TABLE public.watchlist ADD COLUMN IF NOT EXISTS broker_name text';
    EXECUTE 'ALTER TABLE public.watchlist ADD COLUMN IF NOT EXISTS account_name text';
  ELSIF watchlist_kind = 'v' AND to_regclass('public.virtual_positions') IS NOT NULL THEN
    -- compatibility view인 경우 컬럼이 노출되도록 재정의
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
        account_name
      FROM public.virtual_positions
    $view$;

    EXECUTE 'GRANT SELECT ON public.watchlist TO anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist TO service_role';
  END IF;
END $$;

COMMIT;
