create table if not exists public.ui_report_snapshots (
  id bigserial primary key,
  topic text not null,
  audience_key text not null,
  report_date date not null,
  body_text text not null,
  source_label text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists ui_report_snapshots_uq
  on public.ui_report_snapshots (topic, audience_key, report_date);

create index if not exists ui_report_snapshots_report_date_idx
  on public.ui_report_snapshots (report_date desc);
