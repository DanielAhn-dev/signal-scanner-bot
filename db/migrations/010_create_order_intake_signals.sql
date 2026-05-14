create table if not exists public.order_intake_signals (
  id bigserial primary key,
  code text not null,
  sector_id text,
  sector_name text,
  signal_date date not null,
  signal_score numeric not null,
  positive_count integer not null default 0,
  negative_count integer not null default 0,
  headline_count integer not null default 0,
  source text not null default 'news',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists order_intake_signals_code_signal_date_source_uq
  on public.order_intake_signals (code, signal_date, source);

create index if not exists order_intake_signals_signal_date_idx
  on public.order_intake_signals (signal_date desc);

create index if not exists order_intake_signals_sector_signal_date_idx
  on public.order_intake_signals (sector_id, signal_date desc)
  where sector_id is not null;

create index if not exists order_intake_signals_sector_name_signal_date_idx
  on public.order_intake_signals (sector_name, signal_date desc)
  where sector_name is not null;
