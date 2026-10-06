-- 돈 흐름 기록에 '돌려받은 돈'(환급·캐시백)과 '누구 몫'을 적을 수 있게 한다.
-- 1) 결제 수단 값을 넓힌다.
-- refund_regular = 매달 들어오는 환급(모두의카드·K-패스 교통 환급 등), refund_once = 이번만(이벤트 캐시백 등).
-- 금액은 양수로 적고, 그 지출의 소분류에 붙인다. 계산은 src/lib/moneyFlow.ts가 현금 지출에서 뺀다.

alter table public.money_flow_entries drop constraint if exists money_flow_entries_payment_check;

alter table public.money_flow_entries
  add constraint money_flow_entries_payment_check
  check (payment in ('cash', 'point_regular', 'point_once', 'refund_regular', 'refund_once'));

-- 2) 누구 몫: 한 사람이 배우자 지출·환급까지 같이 적을 때 구분한다(메모에 "배우자"가 있으면 화면이 켠다).
--    기록한 사람 기준이다 — 배우자 화면에서는 API가 뒤집어 보여 준다(handlers/ui/money-flow.ts toEntry).
alter table public.money_flow_entries
  add column if not exists for_partner boolean not null default false;
