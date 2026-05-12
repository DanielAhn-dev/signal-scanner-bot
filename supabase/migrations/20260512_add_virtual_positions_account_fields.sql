-- 20260512_add_virtual_positions_account_fields.sql
-- 실계좌/브로커 폴더 개념을 위한 포지션 메타 필드 추가

ALTER TABLE public.virtual_positions
  ADD COLUMN IF NOT EXISTS broker_name text,
  ADD COLUMN IF NOT EXISTS account_name text;

CREATE INDEX IF NOT EXISTS idx_virtual_positions_chat_broker_account
  ON public.virtual_positions (chat_id, broker_name, account_name);
