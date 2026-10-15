-- 돈 흐름 월 합계 칸: 세부를 다 적기 어려울 때 카드 앱의 '이번 달 이용금액'(이용월 기준)만 칸별로 적는다.
-- 칸 이름은 사용자가 정하고(A카드·현금·포인트 등), 새 달에는 화면이 지난달 칸 이름을 이어받는다(칸 목록 테이블은 따로 두지 않음).
--  - kind: cash(통장에서 나감 — 카드·현금) | point(포인트로 냄)
--  - 같은 달 세부 기록(money_flow_entries)과의 차액은 '세부 안 적음'으로 화면이 계산한다(src/lib/moneyFlow.ts reconcileMonth).
--  - 각자 자기 칸만 적는다. 부부 연결로 지출을 공유하면 상대 합계는 읽기만 한다(handlers/ui/money-flow.ts).
-- 가계 재무 정보라 money_flow_entries와 같이 service_role만 접근하고, API가 client_id로 본인 행만 다룬다.

create table if not exists public.money_flow_month_totals (
  client_id text not null,
  month date not null check (extract(day from month) = 1),
  label text not null check (char_length(label) between 1 and 20),
  kind text not null check (kind in ('cash', 'point')),
  amount bigint not null check (amount >= 0 and amount <= 100000000000),
  position smallint not null default 0 check (position between 0 and 11),
  updated_at timestamptz not null default now(),
  primary key (client_id, month, label)
);

alter table public.money_flow_month_totals enable row level security;

drop policy if exists money_flow_month_totals_service_role_all on public.money_flow_month_totals;
create policy money_flow_month_totals_service_role_all
on public.money_flow_month_totals for all to service_role
using (true) with check (true);
