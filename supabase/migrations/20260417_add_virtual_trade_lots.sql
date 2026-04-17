CREATE TABLE IF NOT EXISTS public.virtual_trade_lots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id bigint NOT NULL,
  watchlist_id bigint REFERENCES public.watchlist(id) ON DELETE SET NULL,
  code text NOT NULL REFERENCES public.stocks(code),
  acquired_price numeric NOT NULL CHECK (acquired_price > 0),
  acquired_quantity integer NOT NULL CHECK (acquired_quantity > 0),
  remaining_quantity integer NOT NULL CHECK (
    remaining_quantity >= 0 AND remaining_quantity <= acquired_quantity
  ),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  source_trade_id bigint REFERENCES public.virtual_trades(id) ON DELETE SET NULL,
  seed_watchlist_id bigint,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_virtual_trade_lots_chat_code_open
  ON public.virtual_trade_lots(chat_id, code, acquired_at, id)
  WHERE remaining_quantity > 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_virtual_trade_lots_seed_watchlist
  ON public.virtual_trade_lots(seed_watchlist_id)
  WHERE seed_watchlist_id IS NOT NULL;

ALTER TABLE public.virtual_trade_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_trade_lots_anon_read" ON public.virtual_trade_lots;
CREATE POLICY "virtual_trade_lots_anon_read"
  ON public.virtual_trade_lots FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "virtual_trade_lots_service_write" ON public.virtual_trade_lots;
CREATE POLICY "virtual_trade_lots_service_write"
  ON public.virtual_trade_lots FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.virtual_trade_lots IS '가상거래 FIFO 로트';
COMMENT ON COLUMN public.virtual_trade_lots.acquired_price IS '로트별 취득 단가';
COMMENT ON COLUMN public.virtual_trade_lots.acquired_quantity IS '로트 최초 수량';
COMMENT ON COLUMN public.virtual_trade_lots.remaining_quantity IS '로트 잔여 수량';
COMMENT ON COLUMN public.virtual_trade_lots.seed_watchlist_id IS '기존 watchlist 보유분을 FIFO 초기 로트로 이행한 경우 원본 watchlist id';

CREATE TABLE IF NOT EXISTS public.virtual_trade_lot_matches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trade_id bigint NOT NULL REFERENCES public.virtual_trades(id) ON DELETE CASCADE,
  lot_id bigint NOT NULL REFERENCES public.virtual_trade_lots(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  code text NOT NULL REFERENCES public.stocks(code),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL CHECK (unit_cost > 0),
  cost_amount numeric NOT NULL,
  pnl_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_virtual_trade_lot_matches_trade
  ON public.virtual_trade_lot_matches(trade_id);

CREATE INDEX IF NOT EXISTS idx_virtual_trade_lot_matches_lot
  ON public.virtual_trade_lot_matches(lot_id);

ALTER TABLE public.virtual_trade_lot_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_trade_lot_matches_anon_read" ON public.virtual_trade_lot_matches;
CREATE POLICY "virtual_trade_lot_matches_anon_read"
  ON public.virtual_trade_lot_matches FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "virtual_trade_lot_matches_service_write" ON public.virtual_trade_lot_matches;
CREATE POLICY "virtual_trade_lot_matches_service_write"
  ON public.virtual_trade_lot_matches FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.virtual_trade_lot_matches IS '가상 매도 거래와 FIFO 로트 매칭';

INSERT INTO public.virtual_trade_lots (
  chat_id,
  watchlist_id,
  code,
  acquired_price,
  acquired_quantity,
  remaining_quantity,
  acquired_at,
  seed_watchlist_id,
  note
)
SELECT
  w.chat_id,
  w.id,
  w.code,
  ROUND(
    COALESCE(
      CASE
        WHEN COALESCE(w.invested_amount, 0) > 0 AND COALESCE(w.quantity, 0) > 0
          THEN w.invested_amount / NULLIF(w.quantity, 0)
        ELSE w.buy_price
      END,
      w.buy_price
    )::numeric,
    4
  ) AS acquired_price,
  GREATEST(1, COALESCE(w.quantity, 0)) AS acquired_quantity,
  GREATEST(1, COALESCE(w.quantity, 0)) AS remaining_quantity,
  COALESCE(
    CASE
      WHEN w.buy_date IS NOT NULL THEN ((w.buy_date::text || ' 09:00:00+09')::timestamptz)
      ELSE NULL
    END,
    w.created_at,
    now()
  ) AS acquired_at,
  w.id,
  'fifo-migration-seed'
FROM public.watchlist w
WHERE COALESCE(w.quantity, 0) > 0
  AND COALESCE(w.buy_price, 0) > 0
  AND COALESCE(w.status, 'holding') <> 'closed'
ON CONFLICT DO NOTHING;