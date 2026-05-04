-- Add per-user admin flag to web advanced access list.
alter table if exists public.web_advanced_access_users
  add column if not exists is_admin boolean not null default false;

create index if not exists idx_web_advanced_access_users_admin_enabled
  on public.web_advanced_access_users (is_admin, is_enabled)
  where is_admin = true and is_enabled = true;
