-- 민감한 테이블 RLS 강화
-- 웹 UI는 API 핸들러(service_role)를 통해서만 접근하므로 anon 직접 접근 불필요

-- ─── 1. jobs: RLS 활성화 + service_role 전용 ───
-- 기존: DISABLE ROW LEVEL SECURITY (모든 anon/authenticated에 노출)
-- 변경: service_role만 접근 가능 (chat_id가 포함된 페이로드 보호)
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jobs_service_write" ON public.jobs;
CREATE POLICY "jobs_service_write"
  ON public.jobs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── 2. users: anon 전체 읽기 정책 제거 ───
-- 기존: TO anon USING (true) → 모든 유저의 prefs(virtual_cash 등) 노출
-- 변경: service_role만
DROP POLICY IF EXISTS "users_anon_read" ON public.users;

DROP POLICY IF EXISTS "users_service_write" ON public.users;
CREATE POLICY "users_service_write"
  ON public.users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
