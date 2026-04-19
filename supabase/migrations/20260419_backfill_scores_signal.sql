-- 20260419_backfill_scores_signal.sql
-- scores.signal 컬럼 표준화 및 기존 데이터 백필

ALTER TABLE public.scores
  ADD COLUMN IF NOT EXISTS signal text;

-- 기존 데이터 정규화
-- 우선: 이미 유효한 값은 대문자 표준화
-- 다음: 값이 없거나 비정상 값이면 total_score 기준으로 백필
UPDATE public.scores
SET signal = CASE
  WHEN UPPER(COALESCE(signal, '')) IN ('BUY', 'STRONG_BUY', 'WATCH', 'HOLD', 'SELL', 'NONE')
    THEN UPPER(signal)
  WHEN total_score IS NULL
    THEN 'NONE'
  WHEN total_score >= 85
    THEN 'STRONG_BUY'
  WHEN total_score >= 70
    THEN 'BUY'
  WHEN total_score >= 55
    THEN 'WATCH'
  WHEN total_score <= 20
    THEN 'SELL'
  ELSE 'HOLD'
END
WHERE signal IS NULL
   OR BTRIM(signal) = ''
   OR UPPER(signal) NOT IN ('BUY', 'STRONG_BUY', 'WATCH', 'HOLD', 'SELL', 'NONE');

-- 향후 데이터 품질 보장을 위한 제약
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scores_signal_check'
      AND conrelid = 'public.scores'::regclass
  ) THEN
    ALTER TABLE public.scores
      ADD CONSTRAINT scores_signal_check
      CHECK (signal IN ('BUY', 'STRONG_BUY', 'WATCH', 'HOLD', 'SELL', 'NONE'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scores_asof_signal
  ON public.scores (asof, signal);
