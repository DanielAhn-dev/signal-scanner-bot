CREATE TABLE IF NOT EXISTS public.virtual_strategy_gate_states (
  chat_id bigint NOT NULL,
  strategy_id text NOT NULL,
  strategy_profile text,
  gate_status text NOT NULL CHECK (gate_status IN ('promote', 'hold', 'watch', 'pause')),
  sell_count integer NOT NULL DEFAULT 0,
  win_rate numeric(5,2) NOT NULL DEFAULT 0,
  profit_factor numeric(8,4),
  max_loss_streak integer NOT NULL DEFAULT 0,
  window_days integer NOT NULL DEFAULT 45,
  asof timestamptz NOT NULL DEFAULT now(),
  meta jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_virtual_strategy_gate_states_status
  ON public.virtual_strategy_gate_states(gate_status, asof DESC);

ALTER TABLE public.virtual_strategy_gate_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_strategy_gate_states_anon_read" ON public.virtual_strategy_gate_states;
CREATE POLICY "virtual_strategy_gate_states_anon_read"
  ON public.virtual_strategy_gate_states FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "virtual_strategy_gate_states_service_write" ON public.virtual_strategy_gate_states;
CREATE POLICY "virtual_strategy_gate_states_service_write"
  ON public.virtual_strategy_gate_states FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.virtual_strategy_gate_states IS '사용자별 자동매매 전략 게이트 상태 스냅샷';
