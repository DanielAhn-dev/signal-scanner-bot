import test from "node:test";
import assert from "node:assert/strict";
import {
  ADD_ON_MIN_GAIN_PCT,
  capQuantityToCash,
  computeAddOnPosition,
  planAddOnBuy,
  planNewEntry,
  type BuySizingContext,
  type ProfileBase,
} from "../src/services/virtualAutoTradeBuyDecision";

// 신호 관문을 통과하는 요인: 200·50일선 위, 거래량·RSI·추세 양호
const strongFactors = {
  sma200: 50_000,
  sma50: 60_000,
  rsi14: 58,
  avwap_support: 70,
  vol_ratio: 1.5,
  macd_cross: "golden",
  stable_turn: "bull-strong",
  stable_turn_trust: 80,
  stable_above_avg: true,
};
// 200일선 아래 — requireAboveSma200 관문에서 떨어진다
const weakFactors = { ...strongFactors, sma200: 200_000, sma50: 200_000, macd_cross: "dead", stable_turn: "bear-strong" };

const profileBase: ProfileBase = { accountStrategy: "SWING", baseTakeProfitPct: 8, baseStopLossPct: 4, sellSplitCount: 2 };
const sizingContext: BuySizingContext = {
  maxPositions: 10,
  riskBudgetScale: 1,
  prefs: { virtual_seed_capital: 20_000_000, risk_profile: "balanced" },
};

const addOnInput = (overrides: Partial<Parameters<typeof planAddOnBuy>[0]> = {}) => ({
  holding: { quantity: 10, buy_price: 70_000, invested_amount: 700_000, memo: null },
  candidate: { score: 75, isSectorLeader: false },
  executionPrice: 75_000,
  factors: strongFactors,
  minTrustScore: 60,
  profileBase,
  adaptiveRule: null,
  deployableCash: 10_000_000,
  currentHoldingCount: 3,
  sizingContext,
  ...overrides,
});

test("planAddOnBuy: 신호 신뢰도 관문을 못 넘으면 사지 않는다", () => {
  const plan = planAddOnBuy(addOnInput({ factors: weakFactors }));
  assert.equal(plan.action, "skip");
  assert.equal(plan.action === "skip" && plan.reason, "add-on-signal-gate-reject");
});

test(`planAddOnBuy: 평균단가 대비 +${ADD_ON_MIN_GAIN_PCT}% 미만이면 물타기라 사지 않는다`, () => {
  const plan = planAddOnBuy(addOnInput({ executionPrice: 72_000 })); // +2.9%
  assert.equal(plan.action === "skip" && plan.reason, "add-on-anti-pyramiding");
});

test("planAddOnBuy: 조건을 넘으면 종목 목표 예산에서 이미 투입한 금액을 뺀 만큼 산다", () => {
  const plan = planAddOnBuy(addOnInput());
  assert.equal(plan.action, "buy");
  if (plan.action !== "buy") return;
  assert.ok(plan.quantity > 0);
  assert.equal(plan.currentQty, 10);
  assert.equal(plan.currentInvested, 700_000);
});

test("planAddOnBuy: 이미 목표 예산만큼 들고 있으면 더 사지 않는다", () => {
  const plan = planAddOnBuy(addOnInput({ holding: { quantity: 1000, buy_price: 70_000, invested_amount: 70_000_000, memo: null } }));
  assert.equal(plan.action === "skip" && plan.reason, "add-on-below-min-order");
});

test("capQuantityToCash: 현금이 충분하면 수량을 그대로 둔다", () => {
  assert.equal(capQuantityToCash({ quantity: 10, availableCash: 1_000_000, price: 50_000, minOrderAmount: 100_000, cashBuffer: 1.005 }), 10);
});

test("capQuantityToCash: 현금이 모자라면 여유분을 남기고 살 수 있는 만큼으로 줄인다", () => {
  // 50만원 / (5만원 × 1.005) = 9.95 → 9주
  assert.equal(capQuantityToCash({ quantity: 10, availableCash: 500_000, price: 50_000, minOrderAmount: 100_000, cashBuffer: 1.005 }), 9);
});

test("capQuantityToCash: 줄인 금액이 최소 주문액 미만이면 0", () => {
  assert.equal(capQuantityToCash({ quantity: 10, availableCash: 120_000, price: 50_000, minOrderAmount: 200_000, cashBuffer: 1.005 }), 0);
});

test("computeAddOnPosition: 추가매수 후 수량·원금·평균단가를 계산한다", () => {
  assert.deepEqual(computeAddOnPosition({ currentQty: 10, currentInvested: 700_000, addQty: 5, price: 76_000 }), {
    addInvested: 380_000,
    nextQty: 15,
    nextInvested: 1_080_000,
    nextBuyPrice: 72_000,
  });
});

const entryInput = (overrides: Partial<Parameters<typeof planNewEntry>[0]> = {}) => ({
  candidate: { code: "005930", score: 75, signal: "BUY", rsi14: 58, liquidity: 1e11, stableTurn: "bull-strong", stableTrust: 80, isSectorLeader: false },
  executionPrice: 70_000,
  factors: strongFactors,
  newsBias: "neutral" as const,
  riskProfile: "balanced",
  marketPolicy: { mode: "balanced" as const },
  minTrustScore: 60,
  profileBase,
  adaptiveRule: null,
  slotsLeft: 2,
  plannedHoldingCount: 3,
  sizingContext,
  ...overrides,
});

test("planNewEntry: 신호 신뢰도 관문을 못 넘으면 진입하지 않는다", () => {
  const plan = planNewEntry(entryInput({ factors: weakFactors }));
  assert.equal(plan.action === "skip" && plan.reason, "rebalance-signal-gate-reject");
});

test("planNewEntry: 통과하면 사이징 함수를 돌려주고, 투자 가능 금액이 적을수록 적게 산다", () => {
  const plan = planNewEntry(entryInput());
  assert.equal(plan.action, "size");
  if (plan.action !== "size") return;
  const full = plan.size(10_000_000);
  const small = plan.size(1_000_000);
  assert.ok(full.quantity > 0);
  assert.ok(small.investedAmount <= full.investedAmount);
});
