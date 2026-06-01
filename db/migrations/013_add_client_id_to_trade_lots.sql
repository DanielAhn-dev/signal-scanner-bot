-- Add client_id to virtual_trade_lots and virtual_trade_lot_matches
-- These were missed in 012_client_id_identity_phase1.sql

alter table if exists public.virtual_trade_lots
  add column if not exists client_id text;

alter table if exists public.virtual_trade_lot_matches
  add column if not exists client_id text;

-- Also add position_id column if missing (used by newer code)
alter table if exists public.virtual_trade_lots
  add column if not exists position_id bigint references public.virtual_positions(id) on delete set null;

-- Backfill client_id from web_user_profiles via chat_id
do $$
begin
  if to_regclass('public.web_user_profiles') is not null then
    if to_regclass('public.virtual_trade_lots') is not null then
      execute '
        update public.virtual_trade_lots t
           set client_id = p.client_id
          from public.web_user_profiles p
         where t.client_id is null
           and t.chat_id is not null
           and p.telegram_id is not null
           and p.telegram_id::bigint = t.chat_id';
    end if;

    if to_regclass('public.virtual_trade_lot_matches') is not null then
      execute '
        update public.virtual_trade_lot_matches t
           set client_id = p.client_id
          from public.web_user_profiles p
         where t.client_id is null
           and t.chat_id is not null
           and p.telegram_id is not null
           and p.telegram_id::bigint = t.chat_id';
    end if;
  end if;
end $$;

-- Indexes for client_id-first access
create index if not exists idx_virtual_trade_lots_client_id
  on public.virtual_trade_lots (client_id);

create index if not exists idx_virtual_trade_lots_client_code_open
  on public.virtual_trade_lots (client_id, code, acquired_at, id)
  where remaining_quantity > 0;

create index if not exists idx_virtual_trade_lot_matches_client_id
  on public.virtual_trade_lot_matches (client_id);
