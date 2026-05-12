-- 20260512_add_account_fields_virtual_trades.sql
-- 거래 이력에 계좌(브로커/계좌명) 메타 추가

ALTER TABLE public.virtual_trades
  ADD COLUMN IF NOT EXISTS broker_name text,
  ADD COLUMN IF NOT EXISTS account_name text;

CREATE INDEX IF NOT EXISTS idx_virtual_trades_chat_account_time
  ON public.virtual_trades (chat_id, broker_name, account_name, traded_at DESC);
