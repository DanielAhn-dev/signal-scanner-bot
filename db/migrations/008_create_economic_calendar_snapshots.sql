create table if not exists public.economic_calendar_snapshots (
  id bigserial primary key,
  snapshot_key text not null,
  query_type text not null default 'calendar',
  query_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null,
  source_label text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists economic_calendar_snapshots_snapshot_key_uq
  on public.economic_calendar_snapshots (snapshot_key);

create index if not exists economic_calendar_snapshots_fetched_at_idx
  on public.economic_calendar_snapshots (fetched_at desc);

create index if not exists economic_calendar_snapshots_expires_at_idx
  on public.economic_calendar_snapshots (expires_at desc);
