import test from "node:test";
import assert from "node:assert/strict";
import { buildInvestmentPlan } from "../src/lib/investPlan";

test("buildInvestmentPlan: VIX 30 이상이면 sizeFactor 0.5", () => {
  const plan = buildInvestmentPlan({
    currentPrice: 10000,
    factors: {
      sma20: 9800,
      sma50: 9500,
      sma200: 9000,
      rsi14: 58,
      roc21: 2.5,
      avwap_support: 70,
    },
    technicalScore: 72,
    marketEnv: { vix: 30, fearGreed: 45, usdkrw: 1370 },
  });

  assert.equal(plan.sizeFactor, 0.5);
  assert.ok(plan.warnings.some((line) => line.includes("고변동 장")));
});

test("buildInvestmentPlan: 공포탐욕 20 이하면 sizeFactor 1.1", () => {
  const plan = buildInvestmentPlan({
    currentPrice: 10000,
    factors: {
      sma20: 9950,
      sma50: 9800,
      sma200: 9400,
      rsi14: 52,
      roc21: 1.2,
      avwap_support: 68,
    },
    technicalScore: 65,
    marketEnv: { vix: 18, fearGreed: 18, usdkrw: 1320 },
  });

  assert.equal(plan.sizeFactor, 1.1);
});

test("buildInvestmentPlan: 추세 훼손 구간은 wait 상태", () => {
  const plan = buildInvestmentPlan({
    currentPrice: 9000,
    factors: {
      sma20: 9800,
      sma50: 10000,
      sma200: 10200,
      rsi14: 66,
      roc21: -3.2,
      avwap_support: 30,
    },
    technicalScore: 35,
    marketEnv: { vix: 28, fearGreed: 72, usdkrw: 1410 },
  });

  assert.equal(plan.status, "wait");
  assert.ok(plan.warnings.length > 0);
});
