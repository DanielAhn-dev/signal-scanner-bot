alter table if exists public.fundamentals
  add column if not exists available_at timestamptz,
  add column if not exists availability_basis text;

alter table if exists public.fundamental_trends
  add column if not exists available_at timestamptz,
  add column if not exists availability_basis text;

comment on column public.fundamentals.available_at is '재무 데이터가 시스템에서 사용 가능해진 시각. 공시일을 확보하지 못한 원천은 수집 시각을 사용';
comment on column public.fundamentals.availability_basis is '공시 접수일 또는 collection_time';
comment on column public.fundamental_trends.available_at is '재무 트렌드가 시스템에서 사용 가능해진 시각';
comment on column public.fundamental_trends.availability_basis is '공시 접수일 또는 collection_time';
