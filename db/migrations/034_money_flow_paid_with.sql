-- 돈 흐름 세부 기록에 '무엇으로 냈나'를 둔다: card(카드 — 월 합계 칸 안의 일부) | cash(현금·계좌이체 — 합계 칸 밖이라 더한다).
-- 카드는 다음 달 명세서로 언제든 합계를 적을 수 있지만, 현금은 바로 나가 나중에 기억하지 못하면 빠지므로
-- 쓸 때 세부 기록에 '현금'으로 남기고 그 합을 그 달 지출에 더한다(src/lib/moneyFlow.ts monthSpending).
-- 기존 기록은 모두 카드로 본다(그동안 현금 칸 없이 카드 합계 안의 세부로 계산해 왔다).
alter table public.money_flow_entries
  add column if not exists paid_with text not null default 'card';

alter table public.money_flow_entries drop constraint if exists money_flow_entries_paid_with_check;

alter table public.money_flow_entries
  add constraint money_flow_entries_paid_with_check
  check (paid_with in ('card', 'cash'));
