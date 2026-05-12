-- 20260512_create_virtual_account_policies.sql
-- 계좌(브로커/계좌명) 단위 위험 정책 저장

CREATE TABLE IF NOT EXISTS public.virtual_account_policies (
  chat_id bigint NOT NULL,
  broker_name text NOT NULL,
  account_name text NOT NULL,
  risk_profile text NOT NULL DEFAULT 'balanced' CHECK (risk_profile IN ('safe','balanced','active')),
  max_positions integer,
  daily_loss_limit_pct numeric,
  min_cash_reserve_pct numeric,
  add_entry_score_adjust integer NOT NULL DEFAULT 0,
  partial_take_profit_adjust_pct numeric NOT NULL DEFAULT 0,
  stop_loss_pct numeric,
  take_profit_pct numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, broker_name, account_name)
);

CREATE INDEX IF NOT EXISTS idx_virtual_account_policies_chat
  ON public.virtual_account_policies (chat_id, updated_at DESC);

ALTER TABLE public.virtual_account_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_account_policies_anon_read" ON public.virtual_account_policies;
CREATE POLICY "virtual_account_policies_anon_read"
  ON public.virtual_account_policies FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "virtual_account_policies_service_write" ON public.virtual_account_policies;
CREATE POLICY "virtual_account_policies_service_write"
  ON public.virtual_account_policies FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
