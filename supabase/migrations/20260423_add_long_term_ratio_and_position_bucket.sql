-- 20260423_add_long_term_ratio_and_position_bucket.sql
-- 목적:
-- 1) 자동매매 설정에 장기/단기 자산 비중(long_term_ratio) 추가
-- 2) 포지션에 LONG/SWING 버킷(bucket) 추가
-- 3) watchlist 호환 뷰에 bucket 노출

BEGIN;

ALTER TABLE public.virtual_autotrade_settings
  ADD COLUMN IF NOT EXISTS long_term_ratio integer NOT NULL DEFAULT 70;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'virtual_autotrade_settings_long_term_ratio_ck'
      AND conrelid = 'public.virtual_autotrade_settings'::regclass
  ) THEN
    ALTER TABLE public.virtual_autotrade_settings
      ADD CONSTRAINT virtual_autotrade_settings_long_term_ratio_ck
      CHECK (long_term_ratio BETWEEN 0 AND 100);
  END IF;
END $$;

ALTER TABLE public.virtual_positions
  ADD COLUMN IF NOT EXISTS bucket text;

UPDATE public.virtual_positions
SET bucket = CASE
  WHEN UPPER(COALESCE(memo, '')) LIKE '%PROFILE=POSITION_CORE%' THEN 'LONG'
  ELSE 'SWING'
END
WHERE bucket IS NULL;

ALTER TABLE public.virtual_positions
  ALTER COLUMN bucket SET DEFAULT 'SWING';

ALTER TABLE public.virtual_positions
  ALTER COLUMN bucket SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'virtual_positions_bucket_ck'
      AND conrelid = 'public.virtual_positions'::regclass
  ) THEN
    ALTER TABLE public.virtual_positions
      ADD CONSTRAINT virtual_positions_bucket_ck
      CHECK (bucket IN ('LONG', 'SWING'));
  END IF;
END $$;

DROP VIEW IF EXISTS public.watchlist;
CREATE VIEW public.watchlist AS
SELECT
  id,
  chat_id,
  code,
  buy_price,
  buy_date,
  memo,
  created_at,
  updated_at,
  quantity,
  invested_amount,
  bucket,
  status
FROM public.virtual_positions;

COMMENT ON VIEW public.watchlist IS '호환용 뷰: virtual_positions를 참조';

GRANT SELECT ON public.watchlist TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist TO service_role;

COMMIT;
