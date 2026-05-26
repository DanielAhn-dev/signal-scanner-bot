-- 20260526_create_scan_signal_history.sql
-- 목적
-- 1) quick/quick-lite 신호 이력 영속화
-- 2) D-1, D-2 등 신호 경과일 계산의 서버 기준 제공

CREATE TABLE IF NOT EXISTS public.scan_signal_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL,
  trade_date date NOT NULL,
  is_quick_strict boolean NOT NULL DEFAULT false,
  is_quick_lite boolean NOT NULL DEFAULT false,
  quick_score numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(code, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_scan_signal_history_code_date
  ON public.scan_signal_history(code, trade_date DESC);

CREATE INDEX IF NOT EXISTS idx_scan_signal_history_trade_date
  ON public.scan_signal_history(trade_date DESC);

CREATE OR REPLACE FUNCTION public.set_scan_signal_history_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scan_signal_history_updated_at ON public.scan_signal_history;
CREATE TRIGGER trg_scan_signal_history_updated_at
BEFORE UPDATE ON public.scan_signal_history
FOR EACH ROW
EXECUTE FUNCTION public.set_scan_signal_history_updated_at();

ALTER TABLE public.scan_signal_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scan_signal_history_anon_read" ON public.scan_signal_history;
CREATE POLICY "scan_signal_history_anon_read"
  ON public.scan_signal_history FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "scan_signal_history_service_write" ON public.scan_signal_history;
CREATE POLICY "scan_signal_history_service_write"
  ON public.scan_signal_history FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.scan_signal_history IS '스캔 quick/quick-lite 신호 이력';
