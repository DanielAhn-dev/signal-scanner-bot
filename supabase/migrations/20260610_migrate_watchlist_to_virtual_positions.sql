-- 20260610_migrate_watchlist_to_virtual_positions.sql
-- 목적:
-- 1) watchlist가 TABLE인 경우 → watchlist_legacy로 rename 후 virtual_positions로 전체 이전
-- 2) watchlist가 이미 VIEW인 경우 → watchlist_legacy 잔여 데이터 동기화
-- 3) virtual_trade_lots.watchlist_id → position_id 동기화
-- 4) watchlist VIEW 최신 상태 보장 (모든 컬럼 노출)

BEGIN;

-- 1) watchlist가 아직 TABLE인 경우: rename → copy → view 생성
DO $$
DECLARE
  watchlist_kind "char";
BEGIN
  SELECT c.relkind INTO watchlist_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'watchlist'
  LIMIT 1;

  IF watchlist_kind = 'r' THEN
    -- 1-a) watchlist → watchlist_legacy 로 rename
    IF to_regclass('public.watchlist_legacy') IS NULL THEN
      EXECUTE 'ALTER TABLE public.watchlist RENAME TO watchlist_legacy';
    END IF;

    -- 1-b) virtual_positions 테이블 없으면 생성
    IF to_regclass('public.virtual_positions') IS NULL THEN
      EXECUTE $ddl$
        CREATE TABLE public.virtual_positions (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          chat_id bigint NOT NULL,
          code text NOT NULL REFERENCES public.stocks(code),
          buy_price numeric,
          buy_date date DEFAULT CURRENT_DATE,
          memo text,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now(),
          quantity integer,
          invested_amount numeric,
          status text DEFAULT 'holding'
        )
      $ddl$;
      EXECUTE 'ALTER TABLE public.virtual_positions ADD CONSTRAINT virtual_positions_chat_code_uq UNIQUE (chat_id, code)';
      EXECUTE 'ALTER TABLE public.virtual_positions ENABLE ROW LEVEL SECURITY';
      EXECUTE $pol$
        CREATE POLICY "virtual_positions_anon_read" ON public.virtual_positions FOR SELECT TO anon USING (true)
      $pol$;
      EXECUTE $pol$
        CREATE POLICY "virtual_positions_service_write" ON public.virtual_positions FOR ALL TO service_role USING (true) WITH CHECK (true)
      $pol$;
    END IF;
  END IF;
END $$;

-- 2) watchlist_legacy → virtual_positions 데이터 이전 (id 유지, 중복 무시)
DO $$
BEGIN
  IF to_regclass('public.watchlist_legacy') IS NOT NULL
     AND to_regclass('public.virtual_positions') IS NOT NULL
  THEN
    INSERT INTO public.virtual_positions (
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
      status
    )
    OVERRIDING SYSTEM VALUE
    SELECT
      w.id,
      w.chat_id,
      w.code,
      w.buy_price,
      w.buy_date,
      w.memo,
      w.created_at,
      COALESCE(w.updated_at, now()),
      w.quantity,
      w.invested_amount,
      COALESCE(w.status, 'holding')
    FROM public.watchlist_legacy w
    ON CONFLICT (chat_id, code) DO UPDATE SET
      buy_price      = EXCLUDED.buy_price,
      buy_date       = COALESCE(EXCLUDED.buy_date, public.virtual_positions.buy_date),
      quantity       = EXCLUDED.quantity,
      invested_amount = EXCLUDED.invested_amount,
      status         = EXCLUDED.status,
      updated_at     = now()
    WHERE public.virtual_positions.quantity IS DISTINCT FROM EXCLUDED.quantity
       OR public.virtual_positions.buy_price IS DISTINCT FROM EXCLUDED.buy_price;

    -- 시퀀스 최신화
    PERFORM setval(
      pg_get_serial_sequence('public.virtual_positions', 'id'),
      COALESCE((SELECT MAX(id) FROM public.virtual_positions), 1),
      true
    );
  END IF;
END $$;

-- 3) virtual_trade_lots: watchlist_id → position_id 동기화
-- 참조하는 포지션이 이미 삭제된 legacy 포인터(예: 청산 후 삭제된 포지션)는
-- FK 위반을 피하기 위해 건너뛴다 (재실행 멱등성 보장).
UPDATE public.virtual_trade_lots l
SET position_id = l.watchlist_id
WHERE l.position_id IS NULL
  AND l.watchlist_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.virtual_positions p WHERE p.id = l.watchlist_id);

UPDATE public.virtual_trade_lots l
SET seed_position_id = l.seed_watchlist_id
WHERE l.seed_position_id IS NULL
  AND l.seed_watchlist_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.virtual_positions p WHERE p.id = l.seed_watchlist_id);

-- 4) watchlist VIEW 최신 상태 보장 (watchlist가 이제 VIEW여야 함)
DO $$
DECLARE
  watchlist_kind "char";
BEGIN
  SELECT c.relkind INTO watchlist_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'watchlist'
  LIMIT 1;

  -- watchlist가 테이블이면 VIEW로 교체
  IF watchlist_kind = 'r' THEN
    EXECUTE 'DROP TABLE IF EXISTS public.watchlist CASCADE';
  END IF;

  IF to_regclass('public.virtual_positions') IS NOT NULL THEN
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
        planned_review_at,
        stop_loss_percent,
        take_profit_targets,
        auto_trading_enabled
      FROM public.virtual_positions
    $view$;

    EXECUTE 'GRANT SELECT ON public.watchlist TO anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist TO service_role';
  END IF;
END $$;

COMMIT;
