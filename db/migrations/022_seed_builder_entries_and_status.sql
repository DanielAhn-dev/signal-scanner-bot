-- 월 기록 상태(건너뜀 구분)와 확보 내역(여러 번 확보·부분 입금·취소).
-- seed_builder_months.saved_amount 는 더 이상 쓰지 않는 레거시 값이며, 아래에서 확보 내역 1건으로 옮긴다.
alter table public.seed_builder_months
  add column if not exists record_status text not null default 'recorded'
  check (record_status in ('recorded', 'skipped'));

create table if not exists public.seed_builder_entries (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  month date not null check (extract(day from month) = 1),
  entry_date date not null,
  amount bigint not null check (amount > 0),
  deposited_amount bigint not null default 0,
  memo text not null default '' check (char_length(memo) <= 100),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (deposited_amount >= 0 and deposited_amount <= amount)
);

create index if not exists seed_builder_entries_client_month_idx
  on public.seed_builder_entries (client_id, month);

alter table public.seed_builder_entries enable row level security;

create policy seed_builder_entries_service_role_all
on public.seed_builder_entries for all to service_role
using (true) with check (true);

insert into public.seed_builder_entries (client_id, month, entry_date, amount, memo)
select m.client_id, m.month, m.month, m.saved_amount, '이전 기록에서 옮김'
from public.seed_builder_months m
where m.saved_amount > 0
  and not exists (
    select 1 from public.seed_builder_entries e
    where e.client_id = m.client_id and e.month = m.month
  );
