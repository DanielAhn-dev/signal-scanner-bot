-- Risk Signal Detection and Response Strategy Tables
-- 2026-04-18

-- 1. risk_signals 테이블: 매일 계산된 시장 위험도 신호 저장
CREATE TABLE IF NOT EXISTS public.risk_signals (
  signal_date DATE PRIMARY KEY,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  signal_count INT NOT NULL DEFAULT 0,
  factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_signals_date ON public.risk_signals(signal_date DESC);

-- 2. risk_signal_actions 테이블: 사용자가 선택한 위험 대응 전략 기록
CREATE TABLE IF NOT EXISTS public.risk_signal_actions (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  signal_date DATE NOT NULL,
  strategy_selected TEXT NOT NULL CHECK (strategy_selected IN ('HOLD_SAFE', 'REDUCE_TIGHT', 'WAIT_AND_DIP_BUY')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(chat_id, signal_date)
);

CREATE INDEX IF NOT EXISTS idx_risk_signal_actions_chat_date ON public.risk_signal_actions(chat_id, signal_date DESC);

-- 3. virtual_autotrade_settings 테이블에 selected_strategy 컬럼 추가
-- (이미 존재하는 테이블에 컬럼 추가)
ALTER TABLE IF EXISTS public.virtual_autotrade_settings 
ADD COLUMN IF NOT EXISTS selected_strategy TEXT DEFAULT 'HOLD_SAFE' CHECK (selected_strategy IN ('HOLD_SAFE', 'REDUCE_TIGHT', 'WAIT_AND_DIP_BUY', NULL));

-- 기본값 설정
ALTER TABLE public.virtual_autotrade_settings 
ALTER COLUMN selected_strategy SET DEFAULT 'HOLD_SAFE';
