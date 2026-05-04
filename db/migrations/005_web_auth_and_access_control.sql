-- Web auth + advanced access control baseline

create table if not exists public.web_user_profiles (
  client_id text primary key,
  telegram_id bigint,
  nickname text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_web_user_profiles_telegram_id
  on public.web_user_profiles (telegram_id);

create table if not exists public.web_advanced_access_users (
  chat_id bigint primary key,
  nickname text,
  note text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_chat_id bigint
);

create index if not exists idx_web_advanced_access_users_enabled
  on public.web_advanced_access_users (is_enabled)
  where is_enabled = true;

do $$
begin
  if to_regclass('public.web_user_profiles') is not null then
    execute 'alter table public.web_user_profiles enable row level security';

    execute 'drop policy if exists web_user_profiles_select_own on public.web_user_profiles';
    execute 'drop policy if exists web_user_profiles_insert_own on public.web_user_profiles';
    execute 'drop policy if exists web_user_profiles_update_own on public.web_user_profiles';
    execute 'drop policy if exists web_user_profiles_service_role_all on public.web_user_profiles';

    execute 'create policy web_user_profiles_select_own on public.web_user_profiles for select to authenticated using (client_id = auth.uid()::text)';
    execute 'create policy web_user_profiles_insert_own on public.web_user_profiles for insert to authenticated with check (client_id = auth.uid()::text)';
    execute 'create policy web_user_profiles_update_own on public.web_user_profiles for update to authenticated using (client_id = auth.uid()::text) with check (client_id = auth.uid()::text)';
    execute 'create policy web_user_profiles_service_role_all on public.web_user_profiles for all to service_role using (true) with check (true)';
  end if;
end $$;

alter table public.web_advanced_access_users enable row level security;

drop policy if exists web_advanced_access_users_service_role_all on public.web_advanced_access_users;
drop policy if exists web_advanced_access_users_select_own on public.web_advanced_access_users;

create policy web_advanced_access_users_service_role_all
on public.web_advanced_access_users
for all
to service_role
using (true)
with check (true);

create policy web_advanced_access_users_select_own
on public.web_advanced_access_users
for select
to authenticated
using (
  exists (
    select 1
    from public.web_user_profiles p
    where p.client_id = auth.uid()::text
      and p.telegram_id::bigint = web_advanced_access_users.chat_id
      and web_advanced_access_users.is_enabled = true
  )
);
