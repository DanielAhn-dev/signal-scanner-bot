-- 20260527_add_virtual_positions_horizon_context.sql
-- 목적:
-- 1) 종목별 목표 보유수평선(단타/스윙/중장기) 기록
-- 2) 진입 시 거시/뉴스 컨텍스트 저장
-- 3) 계획 재점검 시각(planned_review_at) 저장

BEGIN;

ALTER TABLE public.virtual_positions
  ADD COLUMN IF NOT EXISTS target_horizon text,
  ADD COLUMN IF NOT EXISTS horizon_reason text,
  ADD COLUMN IF NOT EXISTS macro_context_at_entry jsonb,
  ADD COLUMN IF NOT EXISTS news_context_at_entry jsonb,
  ADD COLUMN IF NOT EXISTS planned_review_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_virtual_positions_target_horizon
  ON public.virtual_positions (target_horizon);

CREATE INDEX IF NOT EXISTS idx_virtual_positions_planned_review_at
  ON public.virtual_positions (planned_review_at)
  WHERE planned_review_at IS NOT NULL;

COMMIT;
