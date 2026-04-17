-- 20260418_create_virtual_autotrade.sql
-- 가상 자동매매 설정/실행 이력 테이블

CREATE TABLE IF NOT EXISTS public.virtual_autotrade_settings (
  chat_id bigint PRIMARY KEY,
  is_enabled boolean NOT NULL DEFAULT false,
  monday_buy_slots integer NOT NULL DEFAULT 2,
  max_positions integer NOT NULL DEFAULT 10,
  min_buy_score integer NOT NULL DEFAULT 72,
  take_profit_pct numeric NOT NULL DEFAULT 8,
  stop_loss_pct numeric NOT NULL DEFAULT 4,
  last_monday_buy_at timestamptz,
  last_daily_review_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.virtual_autotrade_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_autotrade_settings_anon_read" ON public.virtual_autotrade_settings;
CREATE POLICY "virtual_autotrade_settings_anon_read"
  ON public.virtual_autotrade_settings FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "virtual_autotrade_settings_service_write" ON public.virtual_autotrade_settings;
CREATE POLICY "virtual_autotrade_settings_service_write"
  ON public.virtual_autotrade_settings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.virtual_autotrade_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_type text NOT NULL CHECK (run_type IN ('MONDAY_BUY', 'DAILY_REVIEW', 'MANUAL')),
  run_key text NOT NULL,
  chat_id bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('SUCCESS', 'SKIPPED', 'FAILED')),
  summary jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_virtual_autotrade_runs_unique
  ON public.virtual_autotrade_runs(run_type, run_key, chat_id);

CREATE INDEX IF NOT EXISTS idx_virtual_autotrade_runs_chat_time
  ON public.virtual_autotrade_runs(chat_id, started_at DESC);

ALTER TABLE public.virtual_autotrade_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_autotrade_runs_anon_read" ON public.virtual_autotrade_runs;
CREATE POLICY "virtual_autotrade_runs_anon_read"
  ON public.virtual_autotrade_runs FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "virtual_autotrade_runs_service_write" ON public.virtual_autotrade_runs;
CREATE POLICY "virtual_autotrade_runs_service_write"
  ON public.virtual_autotrade_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.virtual_autotrade_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id bigint REFERENCES public.virtual_autotrade_runs(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  code text,
  action_type text NOT NULL CHECK (action_type IN ('BUY', 'SELL', 'HOLD', 'SKIP', 'ERROR')),
  reason text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_virtual_autotrade_actions_run
  ON public.virtual_autotrade_actions(run_id);

CREATE INDEX IF NOT EXISTS idx_virtual_autotrade_actions_chat_time
  ON public.virtual_autotrade_actions(chat_id, created_at DESC);

ALTER TABLE public.virtual_autotrade_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_autotrade_actions_anon_read" ON public.virtual_autotrade_actions;
CREATE POLICY "virtual_autotrade_actions_anon_read"
  ON public.virtual_autotrade_actions FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "virtual_autotrade_actions_service_write" ON public.virtual_autotrade_actions;
CREATE POLICY "virtual_autotrade_actions_service_write"
  ON public.virtual_autotrade_actions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.virtual_autotrade_settings IS '가상 자동매매 사용자별 설정';
COMMENT ON TABLE public.virtual_autotrade_runs IS '가상 자동매매 실행 이력';
COMMENT ON TABLE public.virtual_autotrade_actions IS '가상 자동매매 액션 로그';
