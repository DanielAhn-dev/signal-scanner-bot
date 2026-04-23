-- 20260423_add_last_long_term_coach_at.sql
-- 목적: 장기 코어 코칭 알림 마지막 발송 시각 추적

BEGIN;

ALTER TABLE public.virtual_autotrade_settings
  ADD COLUMN IF NOT EXISTS last_long_term_coach_at timestamptz;

COMMIT;
