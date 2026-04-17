-- 20260418_refactor_watchlist_to_virtual_positions.sql
-- 목적
-- 1) 기존 watchlist 데이터를 virtual_positions(정식 포지션 테이블)로 복제
-- 2) 기존 코드 호환을 위해 watchlist 이름을 compatibility view로 유지
-- 3) virtual_trade_lots는 신규 position_id 계열 컬럼을 병행 저장

BEGIN;

-- 0) 기존 watchlist 테이블을 legacy로 보관
DO $$
BEGIN
  IF to_regclass('public.watchlist_legacy') IS NULL
     AND to_regclass('public.watchlist') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'watchlist'
     )
  THEN
    EXECUTE 'ALTER TABLE public.watchlist RENAME TO watchlist_legacy';
  END IF;
END $$;

-- 1) 정식 포지션 테이블 생성
CREATE TABLE IF NOT EXISTS public.virtual_positions (
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
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'virtual_positions_chat_code_uq'
      AND conrelid = 'public.virtual_positions'::regclass
  ) THEN
    ALTER TABLE public.virtual_positions
      ADD CONSTRAINT virtual_positions_chat_code_uq UNIQUE (chat_id, code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_virtual_positions_chat_id ON public.virtual_positions(chat_id);

ALTER TABLE public.virtual_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_positions_anon_read" ON public.virtual_positions;
CREATE POLICY "virtual_positions_anon_read"
  ON public.virtual_positions FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "virtual_positions_service_write" ON public.virtual_positions;
CREATE POLICY "virtual_positions_service_write"
  ON public.virtual_positions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.virtual_positions IS '가상 보유 포지션(정식)';

-- 2) legacy 데이터 복제 (id 유지)
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
  COALESCE(w.updated_at, now()) AS updated_at,
  w.quantity,
  w.invested_amount,
  COALESCE(w.status, 'holding')
FROM public.watchlist_legacy w
ON CONFLICT (id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('public.virtual_positions', 'id'),
  COALESCE((SELECT MAX(id) FROM public.virtual_positions), 1),
  true
);

-- 3) 기존 watchlist 이름을 compatibility view로 제공
DROP VIEW IF EXISTS public.watchlist;
CREATE VIEW public.watchlist AS
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
  status
FROM public.virtual_positions;

COMMENT ON VIEW public.watchlist IS '호환용 뷰: virtual_positions를 참조';

GRANT SELECT ON public.watchlist TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist TO service_role;

-- 4) updated_at 트리거를 신규 테이블에 연결
DROP TRIGGER IF EXISTS trg_watchlist_updated_at ON public.watchlist_legacy;
DROP TRIGGER IF EXISTS trg_virtual_positions_updated_at ON public.virtual_positions;
CREATE TRIGGER trg_virtual_positions_updated_at
BEFORE UPDATE ON public.virtual_positions
FOR EACH ROW
EXECUTE FUNCTION public.update_watchlist_updated_at();

-- 5) lots 테이블에 신규 FK 컬럼 병행 추가
ALTER TABLE public.virtual_trade_lots
  ADD COLUMN IF NOT EXISTS position_id bigint,
  ADD COLUMN IF NOT EXISTS seed_position_id bigint;

UPDATE public.virtual_trade_lots
SET
  position_id = COALESCE(position_id, watchlist_id),
  seed_position_id = COALESCE(seed_position_id, seed_watchlist_id)
WHERE position_id IS NULL
   OR seed_position_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_virtual_trade_lots_position'
      AND conrelid = 'public.virtual_trade_lots'::regclass
  ) THEN
    ALTER TABLE public.virtual_trade_lots
      ADD CONSTRAINT fk_virtual_trade_lots_position
      FOREIGN KEY (position_id) REFERENCES public.virtual_positions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_virtual_trade_lots_seed_position'
      AND conrelid = 'public.virtual_trade_lots'::regclass
  ) THEN
    ALTER TABLE public.virtual_trade_lots
      ADD CONSTRAINT fk_virtual_trade_lots_seed_position
      FOREIGN KEY (seed_position_id) REFERENCES public.virtual_positions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_virtual_trade_lots_position_id
  ON public.virtual_trade_lots(position_id);

CREATE INDEX IF NOT EXISTS idx_virtual_trade_lots_seed_position_id
  ON public.virtual_trade_lots(seed_position_id);

COMMIT;
