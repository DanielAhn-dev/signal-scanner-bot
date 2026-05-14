-- 20260514_add_stop_loss_take_profit.sql
-- 손절/익절 자동화 기능 추가

BEGIN;

-- 1) virtual_positions에 손절/익절 설정 컬럼 추가
ALTER TABLE public.virtual_positions
  ADD COLUMN IF NOT EXISTS stop_loss_percent numeric,
  ADD COLUMN IF NOT EXISTS take_profit_targets jsonb,
  ADD COLUMN IF NOT EXISTS auto_trading_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS entry_date timestamptz DEFAULT now();

COMMENT ON COLUMN public.virtual_positions.stop_loss_percent IS '손절 기준 (%), 예: -5';
COMMENT ON COLUMN public.virtual_positions.take_profit_targets IS '익절 목표 JSON, 예: [{"target": 5, "percentage": 50}, {"target": 10, "percentage": 100}]';
COMMENT ON COLUMN public.virtual_positions.auto_trading_enabled IS '자동 매매 활성화 여부';
COMMENT ON COLUMN public.virtual_positions.entry_date IS '포지션 진입 날짜';

-- 2) 손절/익절 실행 기록 테이블
CREATE TABLE IF NOT EXISTS public.stop_loss_take_profit_executions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id bigint NOT NULL,
  position_id bigint NOT NULL REFERENCES public.virtual_positions(id) ON DELETE CASCADE,
  code text NOT NULL,
  execution_type text NOT NULL, -- 'STOP_LOSS' | 'TAKE_PROFIT'
  trigger_reason text, -- 'price_level_5' | 'price_level_10' | 'time_exit'
  quantity_sold integer,
  execution_price numeric,
  execution_pnl numeric,
  executed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sl_tp_chat_id ON public.stop_loss_take_profit_executions(chat_id);
CREATE INDEX IF NOT EXISTS idx_sl_tp_position_id ON public.stop_loss_take_profit_executions(position_id);
CREATE INDEX IF NOT EXISTS idx_sl_tp_code ON public.stop_loss_take_profit_executions(code);

ALTER TABLE public.stop_loss_take_profit_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sl_tp_anon_read" ON public.stop_loss_take_profit_executions;
CREATE POLICY "sl_tp_anon_read"
  ON public.stop_loss_take_profit_executions FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "sl_tp_service_write" ON public.stop_loss_take_profit_executions;
CREATE POLICY "sl_tp_service_write"
  ON public.stop_loss_take_profit_executions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.stop_loss_take_profit_executions IS '손절/익절 실행 기록';

-- 3) 포트폴리오 수익률 추적 (실시간)
CREATE TABLE IF NOT EXISTS public.portfolio_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id bigint NOT NULL,
  snapshot_date date DEFAULT CURRENT_DATE,
  total_invested numeric,
  total_current_value numeric,
  total_pnl numeric,
  total_pnl_percent numeric,
  position_count integer,
  risk_level text, -- 'GREEN' | 'YELLOW' | 'RED'
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_snapshots_chat_date
  ON public.portfolio_snapshots(chat_id, snapshot_date);

ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portfolio_snapshots_anon_read" ON public.portfolio_snapshots;
CREATE POLICY "portfolio_snapshots_anon_read"
  ON public.portfolio_snapshots FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "portfolio_snapshots_service_write" ON public.portfolio_snapshots;
CREATE POLICY "portfolio_snapshots_service_write"
  ON public.portfolio_snapshots FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.portfolio_snapshots IS '일일 포트폴리오 스냅샷 (현재가 기반)';

COMMIT;
