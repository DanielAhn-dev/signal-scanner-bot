-- FCM 웹 푸시 토큰 저장 테이블
-- 텔레그램과 별개로 브라우저 PWA 알림(FCM)을 지원하기 위한 채널 추가

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id text NOT NULL,
  token text NOT NULL UNIQUE,
  device_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_client_id ON public.push_tokens (client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_client_device
  ON public.push_tokens (client_id, device_id)
  WHERE device_id IS NOT NULL;

-- 이 레포 컨벤션: 웹 UI는 API 핸들러(service_role)를 통해서만 접근 (20260602_tighten_rls_sensitive_tables.sql 참고)
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_tokens_service_write" ON public.push_tokens;
CREATE POLICY "push_tokens_service_write"
  ON public.push_tokens FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.push_tokens IS 'FCM 웹 푸시 토큰 — client_id(인증된 사용자)당 기기별 최신 토큰 1개';
COMMENT ON COLUMN public.push_tokens.client_id IS 'Supabase Auth user id (web_user_profiles.client_id와 동일)';
COMMENT ON COLUMN public.push_tokens.device_id IS '브라우저 로컬 식별자 — 토큰 로테이션 시 같은 기기 행에 수렴시키기 위함';
