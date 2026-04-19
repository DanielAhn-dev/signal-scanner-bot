-- 20260419_create_virtual_decision_logs.sql
-- 목적
-- 1) 거래 시점의 의사결정 근거를 구조화해 저장
-- 2) 의사결정 후속 성과 라벨을 저장
-- 3) 전략 버전 메타(챔피언/챌린저) 저장

CREATE TABLE IF NOT EXISTS public.virtual_decision_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id bigint NOT NULL,
  code text NOT NULL REFERENCES public.stocks(code),
  action text NOT NULL CHECK (action IN ('BUY', 'SELL', 'ADJUST', 'HOLD', 'SKIP')),
  strategy_id text,
  strategy_version text,
  market_regime text,
  confidence numeric,
  expected_horizon_days integer,
  expected_rr numeric,
  reason_summary text,
  reason_details jsonb,
  linked_trade_id bigint REFERENCES public.virtual_trades(id) ON DELETE SET NULL,
  decision_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_virtual_decision_logs_chat_time
  ON public.virtual_decision_logs(chat_id, decision_at DESC);

CREATE INDEX IF NOT EXISTS idx_virtual_decision_logs_chat_code_time
  ON public.virtual_decision_logs(chat_id, code, decision_at DESC);

CREATE INDEX IF NOT EXISTS idx_virtual_decision_logs_linked_trade
  ON public.virtual_decision_logs(linked_trade_id)
  WHERE linked_trade_id IS NOT NULL;

ALTER TABLE public.virtual_decision_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_decision_logs_anon_read" ON public.virtual_decision_logs;
CREATE POLICY "virtual_decision_logs_anon_read"
  ON public.virtual_decision_logs FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "virtual_decision_logs_service_write" ON public.virtual_decision_logs;
CREATE POLICY "virtual_decision_logs_service_write"
  ON public.virtual_decision_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.virtual_decision_outcomes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_id bigint NOT NULL REFERENCES public.virtual_decision_logs(id) ON DELETE CASCADE,
  horizon_days integer NOT NULL CHECK (horizon_days > 0),
  realized_return_pct numeric,
  mfe_pct numeric,
  mae_pct numeric,
  label text,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_virtual_decision_outcomes_unique
  ON public.virtual_decision_outcomes(decision_id, horizon_days);

CREATE INDEX IF NOT EXISTS idx_virtual_decision_outcomes_eval_time
  ON public.virtual_decision_outcomes(evaluated_at DESC);

ALTER TABLE public.virtual_decision_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_decision_outcomes_anon_read" ON public.virtual_decision_outcomes;
CREATE POLICY "virtual_decision_outcomes_anon_read"
  ON public.virtual_decision_outcomes FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "virtual_decision_outcomes_service_write" ON public.virtual_decision_outcomes;
CREATE POLICY "virtual_decision_outcomes_service_write"
  ON public.virtual_decision_outcomes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.virtual_strategy_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  strategy_id text NOT NULL,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'challenger' CHECK (status IN ('champion', 'challenger', 'retired')),
  params jsonb,
  notes text,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, version)
);

CREATE INDEX IF NOT EXISTS idx_virtual_strategy_versions_status
  ON public.virtual_strategy_versions(strategy_id, status, created_at DESC);

ALTER TABLE public.virtual_strategy_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_strategy_versions_anon_read" ON public.virtual_strategy_versions;
CREATE POLICY "virtual_strategy_versions_anon_read"
  ON public.virtual_strategy_versions FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "virtual_strategy_versions_service_write" ON public.virtual_strategy_versions;
CREATE POLICY "virtual_strategy_versions_service_write"
  ON public.virtual_strategy_versions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.virtual_decision_logs IS '가상매매 의사결정 근거 로그';
COMMENT ON TABLE public.virtual_decision_outcomes IS '의사결정 후속 성과 라벨';
COMMENT ON TABLE public.virtual_strategy_versions IS '전략 버전 메타(챔피언/챌린저)';
