-- Phase 1: client_id-first identity migration (Google web login primary)
-- Keep chat_id for backward compatibility during transition.

-- 1) Add client_id columns on core web tables
alter table if exists public.virtual_positions add column if not exists client_id text;
alter table if exists public.virtual_trades add column if not exists client_id text;
alter table if exists public.virtual_decision_logs add column if not exists client_id text;
alter table if exists public.virtual_autotrade_settings add column if not exists client_id text;
alter table if exists public.jobs add column if not exists client_id text;
alter table if exists public.web_advanced_access_users add column if not exists client_id text;
alter table if exists public.web_advanced_access_users add column if not exists updated_by_client_id text;

do $$
begin
  if exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'watchlist'
       and c.relkind = 'r'
  ) then
    execute 'alter table public.watchlist add column if not exists client_id text';
  end if;
end $$;

-- 2) Backfill client_id from web_user_profiles.telegram_id mappings
-- Only fill where client_id is null and chat_id has a linked profile.

do $$
begin
  if to_regclass('public.web_user_profiles') is not null then
    if to_regclass('public.virtual_positions') is not null then
      execute '
        update public.virtual_positions t
           set client_id = p.client_id
          from public.web_user_profiles p
         where t.client_id is null
           and t.chat_id is not null
           and p.telegram_id is not null
           and p.telegram_id::bigint = t.chat_id';
    end if;

    if to_regclass('public.virtual_trades') is not null then
      execute '
        update public.virtual_trades t
           set client_id = p.client_id
          from public.web_user_profiles p
         where t.client_id is null
           and t.chat_id is not null
           and p.telegram_id is not null
           and p.telegram_id::bigint = t.chat_id';
    end if;

    if to_regclass('public.virtual_decision_logs') is not null then
      execute '
        update public.virtual_decision_logs t
           set client_id = p.client_id
          from public.web_user_profiles p
         where t.client_id is null
           and t.chat_id is not null
           and p.telegram_id is not null
           and p.telegram_id::bigint = t.chat_id';
    end if;

    if to_regclass('public.virtual_autotrade_settings') is not null then
      execute '
        update public.virtual_autotrade_settings t
           set client_id = p.client_id
          from public.web_user_profiles p
         where t.client_id is null
           and t.chat_id is not null
           and p.telegram_id is not null
           and p.telegram_id::bigint = t.chat_id';
    end if;

    if exists (
      select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'watchlist'
         and c.relkind = 'r'
    ) then
      execute '
        update public.watchlist t
           set client_id = p.client_id
          from public.web_user_profiles p
         where t.client_id is null
           and t.chat_id is not null
           and p.telegram_id is not null
           and p.telegram_id::bigint = t.chat_id';
    end if;

    if to_regclass('public.jobs') is not null then
      if exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'jobs'
           and column_name = 'chat_id'
      ) then
        execute '
          update public.jobs t
             set client_id = p.client_id
            from public.web_user_profiles p
           where t.client_id is null
             and t.chat_id is not null
             and p.telegram_id is not null
             and p.telegram_id::bigint = t.chat_id';
      elsif exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'jobs'
           and column_name = 'payload'
      ) then
        execute '
          update public.jobs t
             set client_id = p.client_id
            from public.web_user_profiles p
           where t.client_id is null
             and p.telegram_id is not null
             and coalesce((t.payload ->> ''chat_id''), '''') <> ''''
             and p.telegram_id::text = (t.payload ->> ''chat_id'')';
      end if;
    end if;

    if to_regclass('public.web_advanced_access_users') is not null then
      execute '
        update public.web_advanced_access_users t
           set client_id = p.client_id
          from public.web_user_profiles p
         where t.client_id is null
           and t.chat_id is not null
           and p.telegram_id is not null
           and p.telegram_id::bigint = t.chat_id';
    end if;
  end if;
end $$;

-- 3) Add indexes for client_id-first access
create index if not exists idx_virtual_positions_client_id on public.virtual_positions (client_id);
create index if not exists idx_virtual_trades_client_id on public.virtual_trades (client_id);
create index if not exists idx_virtual_decision_logs_client_id on public.virtual_decision_logs (client_id);
create index if not exists idx_jobs_client_id on public.jobs (client_id);
create index if not exists idx_web_advanced_access_users_client_id on public.web_advanced_access_users (client_id);

do $$
begin
  if exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'watchlist'
       and c.relkind = 'r'
  ) then
    execute 'create index if not exists idx_watchlist_client_id on public.watchlist (client_id)';
  end if;
end $$;

-- 4) Upsert keys for settings/access tables (null-safe unique behavior)
create unique index if not exists ux_virtual_autotrade_settings_client_id
  on public.virtual_autotrade_settings (client_id);

create unique index if not exists ux_web_advanced_access_users_client_id
  on public.web_advanced_access_users (client_id);
