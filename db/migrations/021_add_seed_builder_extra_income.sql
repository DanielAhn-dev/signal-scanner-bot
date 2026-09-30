alter table public.seed_builder_months
  add column if not exists extra_income jsonb not null default '{}'::jsonb;