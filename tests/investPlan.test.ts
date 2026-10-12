import test from "node:test";
import assert from "node:assert/strict";
import {
  depositDayFromPayday,
  investPlanPrefsPatch,
  mergeInvestPlan,
  readInvestPlan,
  type InvestPlan,
} from "../src/services/investPlan";

const base: InvestPlan = { monthly: 500_000, payday: null, depositDay: 1, tolerancePct: null, satellitePct: 10 };

test("depositDayFromPayday: 급여일 다음 날, 28일을 넘으면 다음 달 1일", () => {
  assert.equal(depositDayFromPayday(25), 26);
  assert.equal(depositDayFromPayday(27), 28);
  assert.equal(depositDayFromPayday(28), 1);
  assert.equal(depositDayFromPayday(31), 1);
});

test("readInvestPlan: 예전 계정은 월 입금·입금일·자동매매 방식에서 읽는다", () => {
  const plan = readInvestPlan({ virtual_monthly_deposit: 300_000, virtual_deposit_day: 10, virtual_strategy_mode: "index_hold" });
  assert.deepEqual(plan, { monthly: 300_000, depositDay: 10, payday: null, tolerancePct: null, satellitePct: 0 });
  assert.equal(readInvestPlan({}).satellitePct, 10); // 방식이 없으면 종목 봇(기존 기본값)
});

test("mergeInvestPlan: 급여일만 바꾸면 넣는 날은 급여일 다음 날, 넣는 날을 같이 주면 그 날", () => {
  const a = mergeInvestPlan(base, { payday: 25 });
  assert.ok(a.ok && a.value.depositDay === 26 && a.value.payday === 25);
  const b = mergeInvestPlan(base, { payday: 25, depositDay: 5 });
  assert.ok(b.ok && b.value.depositDay === 5);
});

test("mergeInvestPlan: 준 칸만 바꾸고 잘못된 값은 거절한다", () => {
  const a = mergeInvestPlan(base, { satellitePct: 0 });
  assert.ok(a.ok);
  assert.deepEqual(a.value, { ...base, satellitePct: 0 });
  assert.equal(mergeInvestPlan(base, { monthly: 5_000 }).ok, false);
  assert.equal(mergeInvestPlan(base, { satellitePct: 20 }).ok, false);
  assert.equal(mergeInvestPlan(base, { tolerancePct: 22 }).ok, false);
  assert.equal(mergeInvestPlan(base, { payday: 32 }).ok, false);
});

test("investPlanPrefsPatch: 실험 계좌 월 입금·자동매매 방식을 같이 맞춘다", () => {
  const patch = investPlanPrefsPatch({ ...base, satellitePct: 0, tolerancePct: 30, payday: 25, depositDay: 26 }, {}, "2026-10-12");
  assert.equal(patch.virtual_monthly_deposit, 500_000);
  assert.equal(patch.virtual_deposit_day, 26);
  assert.equal(patch.virtual_strategy_mode, "index_hold");
  assert.deepEqual(patch.invest_plan, { payday: 25, tolerancePct: 30 });
});

test("investPlanPrefsPatch: 개별주 몫만 바꾸면 이번 달 입금 처리 표시를 건드리지 않는다", () => {
  const prefs = { virtual_monthly_deposit: 500_000, virtual_deposit_day: 1, virtual_last_deposit_month: "2026-09" };
  const patch = investPlanPrefsPatch({ ...readInvestPlan(prefs), satellitePct: 0 }, prefs, "2026-10-12");
  assert.equal("virtual_last_deposit_month" in patch, false);
  // 금액을 바꾸면 다시 정한다 (입금일이 지났으면 이번 달은 처리한 것으로)
  const changed = investPlanPrefsPatch({ ...readInvestPlan(prefs), monthly: 700_000 }, prefs, "2026-10-12");
  assert.equal(changed.virtual_last_deposit_month, "2026-10");
});
