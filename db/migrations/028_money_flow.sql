-- 돈 흐름 점검: 빠른 지출 기록, 사용자가 고친 분류(자동 분류 학습), 지금 상태 점검 저장.
-- 분류표(소분류 id·줄일 수 있나 기본값)는 src/lib/moneyFlow.ts에 있고, 여기에는 id만 저장한다.
-- 가계 재무 정보라 seed_builder_* 와 같이 service_role만 접근하고, API가 client_id로 본인 행만 다룬다.

create table if not exists public.money_flow_entries (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  spent_on date not null,
  amount bigint not null check (amount > 0 and amount <= 100000000000),
  memo text not null default '' check (char_length(memo) <= 100),
  category_id text not null check (char_length(category_id) <= 40),
  -- null이면 소분류 기본값을 따른다
  cut_level text check (cut_level in ('must', 'trim', 'drop')),
  must_part bigint check (must_part >= 0),
  payment text not null default 'cash' check (payment in ('cash', 'point_regular', 'point_once')),
  created_at timestamptz not null default now(),
  check (must_part is null or must_part <= amount)
);

create index if not exists money_flow_entries_client_spent_idx
  on public.money_flow_entries (client_id, spent_on);

alter table public.money_flow_entries enable row level security;

create policy money_flow_entries_service_role_all
on public.money_flow_entries for all to service_role
using (true) with check (true);

-- 사용자가 분류를 고치면 열쇠말(수량·금액을 뺀 메모) → 소분류를 기억한다. 같은 열쇠말은 마지막 선택으로 덮는다.
create table if not exists public.money_flow_rules (
  client_id text not null,
  keyword text not null check (char_length(keyword) between 1 and 40),
  category_id text not null check (char_length(category_id) <= 40),
  updated_at timestamptz not null default now(),
  primary key (client_id, keyword)
);

alter table public.money_flow_rules enable row level security;

create policy money_flow_rules_service_role_all
on public.money_flow_rules for all to service_role
using (true) with check (true);

-- 지금 상태 점검 한 번 = 한 행. 입력(수입·고정·변동·비정기·비상자금 적립)을 통째로 저장하고
-- 결과는 저장하지 않는다(분류표 기본값이 바뀌어도 다시 계산되게).
create table if not exists public.money_flow_checks (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  checked_on date not null,
  label text not null default '' check (char_length(label) <= 40),
  input jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists money_flow_checks_client_idx
  on public.money_flow_checks (client_id, checked_on desc);

alter table public.money_flow_checks enable row level security;

create policy money_flow_checks_service_role_all
on public.money_flow_checks for all to service_role
using (true) with check (true);
