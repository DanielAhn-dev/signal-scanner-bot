create table if not exists public.seed_builder_months (
  client_id text not null,
  month date not null,
  household text not null check (household in ('solo', 'single-income', 'dual-income')),
  own_income bigint not null default 0 check (own_income >= 0),
  partner_income bigint not null default 0 check (partner_income >= 0),
  expenses jsonb not null default '{}'::jsonb,
  reserve_amount bigint not null default 0 check (reserve_amount >= 0),
  plan_amount bigint not null default 0 check (plan_amount >= 0),
  saved_amount bigint not null default 0 check (saved_amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (client_id, month),
  check (extract(day from month) = 1)
);

alter table public.seed_builder_months enable row level security;

create policy seed_builder_months_service_role_all
on public.seed_builder_months for all to service_role
using (true) with check (true);