ALTER TABLE public.virtual_trades
  DROP CONSTRAINT IF EXISTS virtual_trades_side_check;

ALTER TABLE public.virtual_trades
  ADD CONSTRAINT virtual_trades_side_check
  CHECK (side IN ('BUY', 'SELL', 'ADJUST'));

COMMENT ON COLUMN public.virtual_trades.side IS '거래구분 BUY/SELL/ADJUST';