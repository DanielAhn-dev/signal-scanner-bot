create table if not exists public.market_breadth_daily (
  trade_date date not null,
  market text not null,
  universe_level text not null default 'core_extended',
  sample_count integer not null default 0,
  advancers integer not null default 0,
  decliners integer not null default 0,
  unchanged integer not null default 0,
  new_high_count integer not null default 0,
  new_low_count integer not null default 0,
  above_sma20_pct numeric(8,2),
  above_sma60_pct numeric(8,2),
  foreign_net numeric,
  institution_net numeric,
  source text not null default 'stock_daily',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trade_date, market, universe_level)
);

create index if not exists idx_market_breadth_date
  on public.market_breadth_daily (trade_date desc, market);

comment on table public.market_breadth_daily is '시장 breadth: 상승·하락·신고가·이평선 위 종목 비율';
