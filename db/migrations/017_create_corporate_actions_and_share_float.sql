create table if not exists public.corporate_actions (
  rcept_no text primary key,
  code text not null,
  event_date date not null,
  event_type text not null,
  report_name text not null,
  source text not null default 'dart_list',
  available_at timestamptz not null,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_corporate_actions_code_date
  on public.corporate_actions (code, event_date desc);

create index if not exists idx_corporate_actions_type_date
  on public.corporate_actions (event_type, event_date desc);

create table if not exists public.share_float_history (
  trade_date date not null,
  code text not null,
  market text,
  shares_outstanding bigint,
  market_cap bigint,
  float_shares bigint,
  float_market_cap bigint,
  source text not null default 'pykrx_market_cap',
  available_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (trade_date, code)
);

create index if not exists idx_share_float_code_date
  on public.share_float_history (code, trade_date desc);

comment on table public.corporate_actions is 'DART 주요 공시 이벤트 원장';
comment on table public.share_float_history is '시점별 상장주식수·시가총액 원장';
