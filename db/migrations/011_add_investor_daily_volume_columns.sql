alter table if exists public.investor_daily
  add column if not exists personal bigint,
  add column if not exists personal_amount bigint,
  add column if not exists foreign_amount bigint,
  add column if not exists institution_amount bigint,
  add column if not exists personal_volume bigint,
  add column if not exists foreign_volume bigint,
  add column if not exists institution_volume bigint;

update public.investor_daily
set
  personal_amount = coalesce(personal_amount, personal),
  foreign_amount = coalesce(foreign_amount, foreign),
  institution_amount = coalesce(institution_amount, institution)
where
  personal_amount is null
  or foreign_amount is null
  or institution_amount is null;
