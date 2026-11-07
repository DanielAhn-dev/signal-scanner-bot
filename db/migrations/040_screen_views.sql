-- 화면별 방문 집계 (정리 대상 판단용) — 하루·화면·사용자당 한 행에 횟수만 쌓는다. 시각·경로 이력은 저장하지 않는다.
-- 실행 필요: Supabase SQL Editor에서 직접 실행. 행 수 ≈ 일 × 화면 × 사용자라 무료 용량에 부담 없음.
create table if not exists public.screen_views (
  day date not null,
  screen text not null check (char_length(screen) between 1 and 40),
  client_id text not null check (char_length(client_id) between 1 and 80),
  views integer not null default 1 check (views > 0),
  primary key (day, screen, client_id)
);

create index if not exists screen_views_day_idx on public.screen_views (day desc);

-- 공개 정책 없음: 서버(service role)만 쓰고 읽는다
alter table public.screen_views enable row level security;

create or replace function public.screen_view_hit(p_day date, p_screen text, p_client text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.screen_views (day, screen, client_id, views)
  values (p_day, p_screen, p_client, 1)
  on conflict (day, screen, client_id) do update set views = public.screen_views.views + 1;
$$;

revoke all on function public.screen_view_hit(date, text, text) from public, anon, authenticated;
