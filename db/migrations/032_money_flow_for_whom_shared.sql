-- 돈 흐름 '누구 몫'에 공용(우리 집)을 기본값으로 둔다.
-- 기록하는 사람이 한 명이고 주로 그 사람 카드로 내도 지출 대부분은 집 공용이다 — '내 몫'이 기본이면 틀린 구분이 된다.
--  - for_whom: shared(공용) | me(기록한 사람 것) | partner(기록한 사람의 배우자 것). 기록한 사람 기준이며
--    배우자 화면에서는 API가 me/partner를 뒤집어 보여 준다(handlers/ui/money-flow.ts toEntry). shared는 그대로.
--  - 예전 for_partner=false는 '내 몫'이 기본값이라 들어간 것이라 공용으로 옮긴다. true만 배우자 것으로 남긴다.
--  - for_partner는 더 쓰지 않는다(지우지 않고 남겨 둔다).
alter table public.money_flow_entries
  add column if not exists for_whom text not null default 'shared';

alter table public.money_flow_entries drop constraint if exists money_flow_entries_for_whom_check;

alter table public.money_flow_entries
  add constraint money_flow_entries_for_whom_check
  check (for_whom in ('shared', 'me', 'partner'));

update public.money_flow_entries set for_whom = 'partner' where for_partner = true and for_whom = 'shared';
