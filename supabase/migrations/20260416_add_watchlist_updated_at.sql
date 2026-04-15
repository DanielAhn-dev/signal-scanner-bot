-- 20260416_add_watchlist_updated_at.sql
-- watchlist.updated_at 컬럼 및 자동 갱신 트리거 추가

ALTER TABLE public.watchlist
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.update_watchlist_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_watchlist_updated_at ON public.watchlist;
CREATE TRIGGER trg_watchlist_updated_at
BEFORE UPDATE ON public.watchlist
FOR EACH ROW
EXECUTE FUNCTION public.update_watchlist_updated_at();

COMMENT ON COLUMN public.watchlist.updated_at IS '관심종목 수정 시각';
