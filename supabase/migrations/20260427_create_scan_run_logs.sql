-- 20260427_create_scan_run_logs.sql
-- 목적
-- 1) /스캔 실행 결과를 누적 저장해 필터 성능 추세를 확인
-- 2) 장중 보정(실시간 가중치) 적용 이력을 기록

CREATE TABLE IF NOT EXISTS public.scan_run_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id bigint NOT NULL,
  user_id bigint,
  query_text text,
  filters text[] NOT NULL DEFAULT '{}',
  risk_profile text,
  signal_trade_date date,
  score_asof date,
  candidate_count integer NOT NULL DEFAULT 0,
  filtered_count integer NOT NULL DEFAULT 0,
  safer_count integer NOT NULL DEFAULT 0,
  final_count integer NOT NULL DEFAULT 0,
  stale_business_gap integer NOT NULL DEFAULT 0,
  realtime_momentum_weight numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_run_logs_chat_time
  ON public.scan_run_logs(chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_run_logs_chat_trade_date
  ON public.scan_run_logs(chat_id, signal_trade_date DESC);

ALTER TABLE public.scan_run_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scan_run_logs_anon_read" ON public.scan_run_logs;
CREATE POLICY "scan_run_logs_anon_read"
  ON public.scan_run_logs FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "scan_run_logs_service_write" ON public.scan_run_logs;
CREATE POLICY "scan_run_logs_service_write"
  ON public.scan_run_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.scan_run_logs IS '스캔 실행 결과 및 필터 성능 추세 로그';
