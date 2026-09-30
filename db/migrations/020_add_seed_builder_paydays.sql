alter table public.seed_builder_months
  add column if not exists own_payday smallint check (own_payday between 1 and 31),
  add column if not exists partner_payday smallint check (partner_payday between 1 and 31);