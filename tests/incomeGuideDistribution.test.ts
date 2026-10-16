import test from "node:test";
import assert from "node:assert/strict";
import { estimateDistribution, BUCKET_YIELD_PCT, type AssetBucket } from "../src/lib/incomeGuide";

test("분배금 추정: 바구니별 분배율 가정에서 세금(15.4%)을 뺀 월 금액", () => {
  const byBucket = new Map<AssetBucket, number>([["covered_call", 10_000_000], ["dividend", 20_000_000]]);
  const d = estimateDistribution(byBucket);
  const gross = 10_000_000 * (BUCKET_YIELD_PCT.covered_call / 100) + 20_000_000 * (BUCKET_YIELD_PCT.dividend / 100);
  assert.equal(d.annualGross, Math.round(gross));
  assert.equal(d.monthlyNet, Math.round((gross * (1 - 0.154)) / 12));
  assert.equal(d.isEstimate, true);
});

test("분배금 추정: 보유가 없으면 0", () => {
  assert.equal(estimateDistribution(new Map()).monthlyNet, 0);
});

import { DEFAULT_INCOME_GUIDE_SETTINGS, buildIncomeGuideView, estimateDistributionRows, resolveYieldPct } from "../src/lib/incomeGuide";
import { buildRebalancePlan } from "../src/lib/rebalancePlan";

test("resolveYieldPct: 최근 12개월 실제값이 있으면 그것, 없거나 음수면 상품 유형별 가정", () => {
  assert.deepEqual(resolveYieldPct("498400", "covered_call", "KODEX 200타겟위클리커버드콜", { "498400": 20.12 }), { pct: 20.12, source: "ttm" });
  assert.deepEqual(resolveYieldPct("498400", "covered_call", "KODEX 200타겟위클리커버드콜", {}), { pct: 15, source: "assumed" });
  assert.equal(resolveYieldPct("278530", "kr_index", "KODEX 200TR", { "278530": 0 }).pct, 0, "TR은 실제 0%");
  assert.equal(resolveYieldPct("X", "dividend", "어떤 배당", { X: -1 }).source, "assumed");
});

test("가이드 요약·할 일(plan)·종목별 계산이 같은 분배율을 쓴다 (2026-10-16 화면마다 20.6만/28만/32만으로 갈림)", () => {
  const holdings = [
    { code: "498400", name: "KODEX 200타겟위클리커버드콜", quantity: 1000, price: 10_000, accountKey: "a", accountLabel: "키움 / 일반" },
    { code: "0105E0", name: "SOL 코리아고배당", quantity: 500, price: 10_000, accountKey: "a", accountLabel: "키움 / 일반" },
  ];
  const yields = { "498400": 20, "0105E0": 6 };
  const view = buildIncomeGuideView({ holdings, settings: DEFAULT_INCOME_GUIDE_SETTINGS, today: "2026-10-16", yieldPctByCode: yields });
  const gross = 10_000_000 * 0.2 + 5_000_000 * 0.06;
  assert.equal(view.distribution.annualGross, gross);
  assert.equal(view.distributions.taxableAnnual, gross);
  const plan = buildRebalancePlan({ holdings: view.holdings, total: view.total, groups: view.groups, settings: DEFAULT_INCOME_GUIDE_SETTINGS, cashPlan: view.cashPlan, yieldPctByCode: yields })!;
  assert.equal(Math.round(plan.income.monthlyNet), view.distribution.monthlyNet);
  assert.equal(estimateDistributionRows([], yields).monthlyNet, 0);
});
