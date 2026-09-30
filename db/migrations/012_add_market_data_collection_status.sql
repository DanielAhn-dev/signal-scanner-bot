alter table if exists public.investor_daily
  add column if not exists collection_status text,
  add column if not exists missing_reason text;

alter table if exists public.stock_credit_short_daily
  add column if not exists collection_status text,
  add column if not exists missing_reason text,
  add column if not exists volume_status text,
  add column if not exists balance_status text;

comment on column public.investor_daily.collection_status is '수급 행 수집 상태: ok, fallback, partial, missing';
comment on column public.investor_daily.missing_reason is '수급 결측 또는 fallback 사유';
comment on column public.stock_credit_short_daily.collection_status is '공매도·잔고 행 종합 상태: ok, partial, no_data, api_error';
comment on column public.stock_credit_short_daily.missing_reason is '공매도·잔고 결측 사유';
comment on column public.stock_credit_short_daily.volume_status is '당일 공매도 거래량 조회 상태: ok, no_row, api_error';
comment on column public.stock_credit_short_daily.balance_status is '공매도 잔고 조회 상태: ok, no_row, api_error';
