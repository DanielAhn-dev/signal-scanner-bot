BEGIN;

CREATE TABLE IF NOT EXISTS public.fundamental_trends (
  code text NOT NULL,
  period_end date NOT NULL,
  quarter_key text NOT NULL,
  is_consensus boolean NOT NULL DEFAULT false,
  sales bigint,
  operating_income bigint,
  eps integer,
  rev_qoq numeric(10,2),
  op_qoq numeric(10,2),
  rev_acceleration numeric(10,2),
  op_acceleration numeric(10,2),
  source text,
  computed jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, period_end)
);

CREATE INDEX IF NOT EXISTS idx_fundamental_trends_code_period_end
  ON public.fundamental_trends (code, period_end DESC);

CREATE INDEX IF NOT EXISTS idx_fundamental_trends_period_end
  ON public.fundamental_trends (period_end DESC);

COMMENT ON TABLE public.fundamental_trends IS '분기 재무 트렌드(QoQ/가속도) 저장';
COMMENT ON COLUMN public.fundamental_trends.quarter_key IS 'YYYYMM 형태 분기 키 (예: 202506)';
COMMENT ON COLUMN public.fundamental_trends.computed IS '추가 파생 지표 JSON';

COMMIT;
