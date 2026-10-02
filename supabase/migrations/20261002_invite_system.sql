-- 초대 전용 가입: 초대권, 가입 대기 신청, 운영 설정
-- 앱은 UI_INVITE_ONLY=true일 때만 이 테이블로 가입을 제한한다 (꺼져 있으면 기존처럼 로그인 즉시 가입).
-- 이미 web_user_profiles에 있는 계정은 모두 기존 회원으로 본다.

create table if not exists public.web_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  -- null이면 관리자가 발급한 초대권
  inviter_client_id text,
  status text not null default 'open' check (status in ('open', 'used', 'revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by_client_id text,
  used_at timestamptz,
  -- 초대받은 사람이 활동을 인정받아 초대한 사람에게 보상(새 초대권)을 준 시각
  rewarded_at timestamptz
);

create index if not exists idx_web_invites_inviter on public.web_invites (inviter_client_id, status);
create index if not exists idx_web_invites_used_by on public.web_invites (used_by_client_id);

create table if not exists public.web_signup_requests (
  client_id text primary key,
  email text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_client_id text
);

create index if not exists idx_web_signup_requests_status on public.web_signup_requests (status, created_at);

-- 운영 설정 (key/value): signups_open(boolean), max_members(number)
create table if not exists public.web_invite_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.web_user_profiles add column if not exists invited_by_client_id text;
alter table public.web_user_profiles add column if not exists joined_via text;

alter table public.web_invites enable row level security;
alter table public.web_signup_requests enable row level security;
alter table public.web_invite_config enable row level security;

drop policy if exists web_invites_service_role_all on public.web_invites;
drop policy if exists web_signup_requests_service_role_all on public.web_signup_requests;
drop policy if exists web_invite_config_service_role_all on public.web_invite_config;

create policy web_invites_service_role_all on public.web_invites
  for all to service_role using (true) with check (true);
create policy web_signup_requests_service_role_all on public.web_signup_requests
  for all to service_role using (true) with check (true);
create policy web_invite_config_service_role_all on public.web_invite_config
  for all to service_role using (true) with check (true);
