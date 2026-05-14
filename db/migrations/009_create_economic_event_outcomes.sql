create table if not exists public.economic_event_outcomes (
  id bigserial primary key,
  event_id text not null,
  event_name text not null,
  country text not null,
  category text not null,
  importance text not null,
  scheduled_at timestamptz not null,
  published_at timestamptz,
  forecast_value numeric,
  actual_value numeric,
  previous_value numeric,
  surprise_value numeric,
  surprise_direction text,
  kospi_return_1d numeric,
  kospi_return_3d numeric,
  kospi_return_5d numeric,
  kospi_return_10d numeric,
  kosdaq_return_1d numeric,
  kosdaq_return_3d numeric,
  kosdaq_return_5d numeric,
  kosdaq_return_10d numeric,
  volatility_change numeric,
  key_driver text,
  market_theme text,
  confidence_score numeric,
  reason_summary text,
  reason_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists economic_event_outcomes_event_id_uq
  on public.economic_event_outcomes (event_id);

create index if not exists economic_event_outcomes_scheduled_at_idx
  on public.economic_event_outcomes (scheduled_at desc);

create index if not exists economic_event_outcomes_importance_idx
  on public.economic_event_outcomes (importance, scheduled_at desc);

create index if not exists economic_event_outcomes_category_idx
  on public.economic_event_outcomes (category, scheduled_at desc);
