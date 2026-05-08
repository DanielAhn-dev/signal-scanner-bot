-- Migration: add eps, bps columns to fundamentals table
-- EPS = 주당순이익 (close / PER 파생)
-- BPS = 주당순자산 (close / PBR 파생)

ALTER TABLE public.fundamentals
  ADD COLUMN IF NOT EXISTS eps numeric,
  ADD COLUMN IF NOT EXISTS bps numeric;

COMMENT ON COLUMN public.fundamentals.eps IS '주당순이익 (현재주가 ÷ PER 파생값)';
COMMENT ON COLUMN public.fundamentals.bps IS '주당순자산 (현재주가 ÷ PBR 파생값)';
