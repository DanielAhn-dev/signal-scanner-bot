-- =============================================
-- 사용자 활동 추적 · 팔로우 · 랭킹 기능 스키마
-- Supabase SQL Editor에서 실행
-- =============================================

-- ─── 1. users 테이블 컬럼 추가 ───

-- UUID 기본값 보장
ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 추가 컬럼
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS language_code text DEFAULT 'ko',
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- tg_id UNIQUE 인덱스 (중복 방지)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'users' AND indexname = 'idx_users_tg_id_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_users_tg_id_unique ON public.users(tg_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_username
  ON public.users(username) WHERE username IS NOT NULL;

-- ─── 2. 사용자 활동 로그 ───

CREATE TABLE IF NOT EXISTS public.user_activity (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tg_id       bigint NOT NULL,
  command     text NOT NULL,
  args        text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_tg_id
  ON public.user_activity(tg_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_created
  ON public.user_activity(created_at DESC);

-- 오래된 로그 자동 정리를 위한 파티셔닝은 선택 사항
-- 운영 시 30일 이상 로그는 cron으로 삭제 권장

-- ─── 3. 팔로우 관계 ───

CREATE TABLE IF NOT EXISTS public.follows (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  follower_tg_id  bigint NOT NULL,
  following_tg_id bigint NOT NULL,
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT follows_unique UNIQUE (follower_tg_id, following_tg_id),
  CONSTRAINT follows_no_self CHECK (follower_tg_id != following_tg_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower
  ON public.follows(follower_tg_id);
CREATE INDEX IF NOT EXISTS idx_follows_following
  ON public.follows(following_tg_id);

-- ─── 4. RLS 정책 ───

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

-- users
CREATE POLICY "users_anon_read"
  ON public.users FOR SELECT TO anon USING (true);
CREATE POLICY "users_service_write"
  ON public.users FOR ALL TO service_role USING (true) WITH CHECK (true);

-- user_activity
CREATE POLICY "user_activity_anon_read"
  ON public.user_activity FOR SELECT TO anon USING (true);
CREATE POLICY "user_activity_service_write"
  ON public.user_activity FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- follows
CREATE POLICY "follows_anon_read"
  ON public.follows FOR SELECT TO anon USING (true);
CREATE POLICY "follows_service_write"
  ON public.follows FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── 5. 코멘트 ───

COMMENT ON TABLE  public.user_activity IS '사용자 명령어 사용 로그';
COMMENT ON TABLE  public.follows       IS '사용자 간 팔로우 관계';
COMMENT ON COLUMN public.users.username       IS '텔레그램 @사용자명';
COMMENT ON COLUMN public.users.first_name     IS '텔레그램 이름 (공개 정보)';
COMMENT ON COLUMN public.users.last_active_at IS '마지막 활동 시간';
COMMENT ON COLUMN public.users.is_active      IS '활성 사용자 여부';
