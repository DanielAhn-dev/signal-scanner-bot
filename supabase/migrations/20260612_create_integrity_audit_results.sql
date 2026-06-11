-- 20260612_create_integrity_audit_results.sql
-- 가상매매 원장 정합성 일일 검산 결과 저장
-- (웹 관제 페이지의 데이터 소스 + 추세 확인용 히스토리)

CREATE TABLE IF NOT EXISTS public.integrity_audit_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at timestamptz NOT NULL DEFAULT now(),
  audit_date date NOT NULL,
  is_healthy boolean NOT NULL,
  issue_count integer NOT NULL DEFAULT 0,
  account_count integer NOT NULL DEFAULT 0,
  summary text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integrity_audit_results_date
  ON public.integrity_audit_results(audit_date DESC, run_at DESC);

ALTER TABLE public.integrity_audit_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integrity_audit_anon_read" ON public.integrity_audit_results;
CREATE POLICY "integrity_audit_anon_read"
  ON public.integrity_audit_results FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "integrity_audit_service_write" ON public.integrity_audit_results;
CREATE POLICY "integrity_audit_service_write"
  ON public.integrity_audit_results FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.integrity_audit_results IS '가상매매 원장 정합성 일일 검산 결과';
COMMENT ON COLUMN public.integrity_audit_results.summary IS '텔레그램으로 발송된 요약 텍스트';
COMMENT ON COLUMN public.integrity_audit_results.detail IS '계정별 검산 상세 (ChatLedgerResult[])';
