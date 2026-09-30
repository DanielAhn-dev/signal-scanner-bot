create table if not exists public.universe_membership_daily (
  trade_date date not null,
  code text not null,
  name text,
  market text,
  mcap_rank integer,
  market_cap bigint,
  close bigint,
  liquidity bigint,
  universe_level text not null,
  is_active boolean not null default true,
  source text not null default 'universe_refresh',
  created_at timestamptz not null default now(),
  primary key (trade_date, code)
);

create index if not exists idx_universe_membership_code_date
  on public.universe_membership_daily (code, trade_date desc);

create index if not exists idx_universe_membership_date_level
  on public.universe_membership_daily (trade_date, universe_level);

comment on table public.universe_membership_daily is '시점별 상장 유니버스·등급 스냅샷. 과거 백테스트 생존편향 완화용';
