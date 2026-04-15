-- 가상 투자 추적 확장
-- watchlist: 수량/원금/상태 필드 추가
-- virtual_trades: 매수/매도 히스토리 기록

ALTER TABLE public.watchlist
  ADD COLUMN IF NOT EXISTS quantity integer,
  ADD COLUMN IF NOT EXISTS invested_amount numeric,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'holding';

COMMENT ON COLUMN public.watchlist.quantity IS '가상 보유 수량';
COMMENT ON COLUMN public.watchlist.invested_amount IS '가상 매수 원금 (수량*매수가)';
COMMENT ON COLUMN public.watchlist.status IS '보유 상태 (holding/closed)';

CREATE TABLE IF NOT EXISTS public.virtual_trades (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id bigint NOT NULL,
  code text NOT NULL REFERENCES public.stocks(code),
  side text NOT NULL CHECK (side IN ('BUY','SELL')),
  price numeric NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  gross_amount numeric NOT NULL,
  net_amount numeric NOT NULL,
  fee_amount numeric DEFAULT 0,
  tax_amount numeric DEFAULT 0,
  pnl_amount numeric DEFAULT 0,
  memo text,
  traded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_virtual_trades_chat_time
  ON public.virtual_trades(chat_id, traded_at DESC);

ALTER TABLE public.virtual_trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_trades_anon_read" ON public.virtual_trades;
CREATE POLICY "virtual_trades_anon_read"
  ON public.virtual_trades FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "virtual_trades_service_write" ON public.virtual_trades;
CREATE POLICY "virtual_trades_service_write"
  ON public.virtual_trades FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.virtual_trades IS '가상 매수/매도 거래 내역';
COMMENT ON COLUMN public.virtual_trades.chat_id IS '텔레그램 chat_id';
COMMENT ON COLUMN public.virtual_trades.code IS '종목코드';
COMMENT ON COLUMN public.virtual_trades.side IS '거래구분 BUY/SELL';
COMMENT ON COLUMN public.virtual_trades.price IS '체결 단가';
COMMENT ON COLUMN public.virtual_trades.quantity IS '체결 수량';
COMMENT ON COLUMN public.virtual_trades.gross_amount IS '총 금액 (수수료/세금 전)';
COMMENT ON COLUMN public.virtual_trades.net_amount IS '순 금액 (수수료/세금 반영 후)';
COMMENT ON COLUMN public.virtual_trades.pnl_amount IS '실현 손익 (SELL 기준)';