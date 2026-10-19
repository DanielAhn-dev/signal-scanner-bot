import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MIX,
  depositDayFromPayday,
  effectiveMix,
  investPlanPrefsPatch,
  mergeInvestPlan,
  normalizeMix,
  readInvestPlan,
  type InvestPlan,
} from "../src/services/userPlan";

const base: InvestPlan = { monthly: 500_000, payday: null, depositDay: 1, tolerancePct: null, satellitePct: 10, mix: null };

test("depositDayFromPayday: 급여일 다음 날, 28일을 넘으면 다음 달 1일", () => {
  assert.equal(depositDayFromPayday(25), 26);
  assert.equal(depositDayFromPayday(27), 28);
  assert.equal(depositDayFromPayday(28), 1);
  assert.equal(depositDayFromPayday(31), 1);
});

test("readInvestPlan: 예전 계정은 월 입금·입금일·자동매매 방식에서 읽는다", () => {
  const plan = readInvestPlan({ virtual_monthly_deposit: 300_000, virtual_deposit_day: 10, virtual_strategy_mode: "index_hold" });
  assert.deepEqual(plan, { monthly: 300_000, depositDay: 10, payday: null, tolerancePct: null, satellitePct: 0, mix: null });
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

test("실험(관리자): 개별주 몫 100은 종목 봇 + 몫 100으로 저장하고 다시 읽힌다", () => {
  const merged = mergeInvestPlan(base, { satellitePct: 100 });
  assert.ok(merged.ok);
  const patch = investPlanPrefsPatch(merged.value, {}, "2026-10-13");
  assert.equal(patch.virtual_strategy_mode, "stock");
  assert.equal(patch.virtual_satellite_cap_pct, 100);
  assert.equal(readInvestPlan({ ...patch }).satellitePct, 100);
  // 10%로 돌아오면 몫도 10으로
  const back = investPlanPrefsPatch({ ...merged.value, satellitePct: 10 }, patch, "2026-10-13");
  assert.equal(back.virtual_satellite_cap_pct, 10);
});

const kospi = { index: "kospi200", weight: 0.5, product: null, account: null };
const sp = { index: "sp500", weight: 0.5, product: { code: "360750", name: "TIGER 미국S&P500" }, account: { broker: "키움", account: "ISA" } };

test("구성: 정하지 않은 계정은 코스피200 100%로 읽고, 계획 저장 때 기본값을 적지 않는다", () => {
  const plan = readInvestPlan({});
  assert.equal(plan.mix, null);
  assert.deepEqual(effectiveMix(plan), [{ index: "kospi200", weight: 1, product: null, account: null }]);
  assert.equal(effectiveMix(plan), DEFAULT_MIX);
  const patch = investPlanPrefsPatch({ ...plan, monthly: 300_000 }, {}, "2026-10-19");
  assert.equal("mix" in (patch.invest_plan as Record<string, unknown>), false);
});

test("구성: 정한 값은 저장 후 다시 읽히고, 다른 칸만 바꿔도 유지된다", () => {
  const merged = mergeInvestPlan(base, { mix: [kospi, sp] });
  assert.ok(merged.ok);
  const prefs = investPlanPrefsPatch(merged.value, {}, "2026-10-19");
  const read = readInvestPlan(prefs);
  assert.deepEqual(read.mix, [kospi, sp]);
  const monthlyOnly = mergeInvestPlan(read, { monthly: 700_000 });
  assert.ok(monthlyOnly.ok);
  assert.deepEqual(monthlyOnly.value.mix, [kospi, sp]);
  // null이면 정하지 않은 상태로 되돌린다
  const cleared = mergeInvestPlan(read, { mix: null });
  assert.ok(cleared.ok && cleared.value.mix === null);
  assert.equal(readInvestPlan(investPlanPrefsPatch(cleared.value, prefs, "2026-10-19")).mix, null);
});

test("구성: 비중 합 1·지수 목록·중복 금지·형식을 서버에서 막는다", () => {
  const bad: unknown[] = [
    [],
    null,
    "kospi200",
    [{ ...kospi, weight: 0.6 }, sp], // 합 1.1
    [{ ...kospi, weight: 0.4 }, sp], // 합 0.9
    [{ ...kospi, weight: 0 }, { ...sp, weight: 1 }], // 0 비중
    [{ ...kospi, weight: -0.5 }, { ...sp, weight: 1.5 }],
    [{ ...kospi, index: "gold" }, sp], // 목록 밖
    [kospi, { ...sp, index: "kospi200" }], // 중복
    [{ ...kospi, weight: "abc" }, sp],
    [{ ...kospi, product: { code: "12345", name: "x" } }, sp], // 코드 5자리
    [{ ...kospi, product: { code: "069500", name: "  " } }, sp], // 이름 없음
    [kospi, { ...sp, account: { broker: "키움", account: "" } }],
    [kospi, { ...sp, account: { broker: "가".repeat(41), account: "ISA" } }],
  ];
  for (const mix of bad) {
    assert.equal(normalizeMix(mix).ok, false, JSON.stringify(mix));
    if (mix !== null) assert.equal(mergeInvestPlan(base, { mix }).ok, false, JSON.stringify(mix));
  }
});

test("구성: 1/3씩처럼 반올림된 비중은 합이 정확히 1이 되게 맞추고 값을 다듬는다", () => {
  const r = normalizeMix([
    { index: "kospi200", weight: 0.333, product: { code: " 0080g0 ", name: " 새 상품 " }, account: null },
    { index: "sp500", weight: 0.333, product: null, account: null },
    { index: "nasdaq100", weight: 0.333, product: null, account: { broker: " 키움 ", account: " 연금저축 " } },
  ]);
  assert.ok(r.ok);
  assert.deepEqual(r.value.map((e) => e.weight), [0.3333, 0.3333, 0.3334]);
  assert.equal(Math.round(r.value.reduce((s, e) => s + e.weight, 0) * 10_000), 10_000);
  assert.deepEqual(r.value[0].product, { code: "0080G0", name: "새 상품" });
  assert.deepEqual(r.value[2].account, { broker: "키움", account: "연금저축" });
});

test("구성: 저장된 값이 깨져 있으면 정하지 않은 것으로 읽는다 (코스피200 100%)", () => {
  const plan = readInvestPlan({ invest_plan: { mix: [{ index: "gold", weight: 1 }] } });
  assert.equal(plan.mix, null);
  assert.equal(effectiveMix(plan)[0].index, "kospi200");
});
