-- 시드 만들기 한 달 예상 지출의 내역(고정비·변동·비정기 적립·비상금 채우기와 각 항목, 출처)을 저장할 때 그대로 남긴다.
-- 고정비·비정기 예산은 '지금 상태 점검', 변동은 지난달 '돈 흐름'에서 계산해 가져오는데,
-- 나중에 점검을 고쳐도 지난 달 기록이 다시 계산되어 바뀌지 않게 저장 시점의 내역을 고정한다(src/lib/moneyFlow.ts SeedPlan).
-- 보여 주기 전용 값이라 계산은 expenses(fixedCost·variableCost·irregularFund·emergencyRefill)로 한다.
alter table public.seed_builder_months
  add column if not exists breakdown jsonb;
