import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAutoTradeBuySizing,
  resolveConvictionScale,
} from "../src/services/virtualAutoTradeSizing";

const BASE_PREFS = {
  capital_krw: 20_000_000,
  risk_profile: "safe" as const,
};

test("sizing: 목표비중 기반 — 시드 2천만원·safe(5종목)이면 종목당 400만원(20%)을 목표로 한다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 20_000_000,
    price: 50_000,
    slotsLeft: 5,
    currentHoldingCount: 0,
    maxPositions: 8,
    stopLossPct: 4,
    prefs: BASE_PREFS,
  });

  assert.equal(result.targetPositions, 5);
  assert.equal(result.baseTargetBudget, 4_000_000);
  // 리스크 상한: 20M * 1% / 4% = 5M → 목표 4M이 그대로 통과
  assert.equal(result.maxBudgetByRisk, 5_000_000);
  assert.equal(result.totalBudget, 4_000_000);
  assert.equal(result.targetWeightPct, 20);
  // 기본 분할 2회 → 1차 진입 60%
  assert.equal(result.splitCount, 2);
  assert.equal(result.budget, 2_400_000);
  assert.equal(result.quantity, 48);
  assert.equal(result.investedAmount, 2_400_000);
  assert.equal(result.skipReason, null);
});

test("sizing: 확신도 1.2면 목표 예산이 20% 증액된다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 20_000_000,
    price: 50_000,
    slotsLeft: 5,
    currentHoldingCount: 0,
    maxPositions: 8,
    stopLossPct: 4,
    conviction: 1.2,
    prefs: BASE_PREFS,
  });

  assert.equal(result.conviction, 1.2);
  assert.equal(result.totalBudget, 4_800_000);
  assert.equal(result.targetWeightPct, 24);
});

test("sizing: 확신도가 높아도 한 종목 비중은 시드의 25%를 넘지 않는다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 20_000_000,
    price: 50_000,
    slotsLeft: 5,
    currentHoldingCount: 0,
    maxPositions: 8,
    stopLossPct: 4,
    conviction: 1.3,
    prefs: BASE_PREFS,
  });

  // 4M * 1.3 = 5.2M > 25% 상한(5M) → 5M으로 캡
  assert.equal(result.totalBudget, 5_000_000);
  assert.equal(result.targetWeightPct, 25);
});

test("sizing: 손절폭이 크면 리스크예산이 상한으로 작동한다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 20_000_000,
    price: 50_000,
    slotsLeft: 5,
    currentHoldingCount: 0,
    maxPositions: 8,
    stopLossPct: 10,
    prefs: BASE_PREFS,
  });

  // 리스크 상한: 20M * 1% / 10% = 2M < 목표 4M → 2M으로 캡
  assert.equal(result.maxBudgetByRisk, 2_000_000);
  assert.equal(result.totalBudget, 2_000_000);
  // 2M은 기본 목표(4M)의 50% 이상이므로 매수는 진행
  assert.equal(result.skipReason, null);
  assert.ok(result.quantity > 0);
});

test("sizing: 일위험축소로 기본 목표의 50% 미만이 되면 꼬마 포지션 대신 매수를 보류한다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 20_000_000,
    price: 50_000,
    slotsLeft: 5,
    currentHoldingCount: 0,
    maxPositions: 8,
    stopLossPct: 4,
    riskBudgetScale: 0.4,
    prefs: BASE_PREFS,
  });

  // 4M * 0.4 = 1.6M < 2M(기본 목표의 50%) → 보류
  assert.equal(result.quantity, 0);
  assert.equal(result.investedAmount, 0);
  assert.equal(result.skipReason, "below-meaningful-size");
});

test("sizing: 현금이 목표의 절반에 못 미치면 자투리 매수 대신 현금을 보존한다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 1_500_000,
    price: 50_000,
    slotsLeft: 1,
    currentHoldingCount: 4,
    maxPositions: 8,
    stopLossPct: 4,
    prefs: BASE_PREFS,
  });

  // 기본 목표 4M의 50% = 2M > 가용 1.5M → 보류
  assert.equal(result.quantity, 0);
  assert.equal(result.skipReason, "below-meaningful-size");
});

test("sizing: split_count 1이면 목표 전액을 한 번에 진입한다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 20_000_000,
    price: 50_000,
    slotsLeft: 5,
    currentHoldingCount: 0,
    maxPositions: 8,
    stopLossPct: 4,
    prefs: { ...BASE_PREFS, split_count: 1 },
  });

  assert.equal(result.splitCount, 1);
  assert.equal(result.budget, 4_000_000);
  assert.equal(result.quantity, 80);
});

test("sizing: split_count 3 이상이면 1차 진입은 50%", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 20_000_000,
    price: 50_000,
    slotsLeft: 5,
    currentHoldingCount: 0,
    maxPositions: 8,
    stopLossPct: 4,
    prefs: { ...BASE_PREFS, split_count: 3 },
  });

  assert.equal(result.splitCount, 3);
  assert.equal(result.budget, 2_000_000);
});

test("sizing: 1차 진입 금액이 최소주문에 못 미치면 분할을 자동 축소한다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 1_000_000,
    price: 10_000,
    slotsLeft: 1,
    currentHoldingCount: 0,
    maxPositions: 8,
    stopLossPct: 4,
    prefs: {
      capital_krw: 2_000_000,
      risk_profile: "safe",
      virtual_target_positions: 2,
      split_count: 4,
    },
  });

  // 시드 2M·2종목 → 기본 목표 1M이지만 리스크 상한(2M*1%/4% = 500k)이 캡
  // 4분할 1차(50%) = 250k ≥ 최소주문 100k → 축소 불필요
  assert.equal(result.configuredSplitCount, 4);
  assert.equal(result.splitCount, 4);
  assert.equal(result.totalBudget, 500_000);
  assert.equal(result.budget, 250_000);
  assert.ok(result.quantity > 0);
});

test("sizing: 고가주라 1주도 못 사면 0주를 반환한다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 20_000_000,
    price: 9_000_000,
    slotsLeft: 5,
    currentHoldingCount: 0,
    maxPositions: 8,
    stopLossPct: 4,
    prefs: BASE_PREFS,
  });

  assert.equal(result.quantity, 0);
  assert.equal(result.investedAmount, 0);
});

test("sizing: 시드가 작아도 최소주문 하한(10만원)을 지킨다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 2_000_000,
    price: 180_000,
    slotsLeft: 1,
    currentHoldingCount: 0,
    maxPositions: 6,
    stopLossPct: 4,
    prefs: {
      capital_krw: 2_000_000,
      risk_profile: "safe",
      split_count: 1,
    },
  });

  assert.equal(result.minOrderAmount, 100_000);
  // 시드 2M·5종목 → 목표 400k → 180k짜리 2주 = 360k ≥ 100k
  assert.equal(result.quantity, 2);
  assert.equal(result.skipReason, null);
});

test("resolveConvictionScale: 점수 70 이상 + 신뢰 A + 섹터리더면 상한 1.3", () => {
  assert.equal(
    resolveConvictionScale({ score: 75, trustGrade: "A", isSectorLeader: true }),
    1.3
  );
});

test("resolveConvictionScale: 점수 55 보통이면 1.0", () => {
  assert.equal(resolveConvictionScale({ score: 55 }), 1.0);
});

test("resolveConvictionScale: 점수 40 미만 + 신뢰 D면 하한 0.7", () => {
  assert.equal(resolveConvictionScale({ score: 35, trustGrade: "D" }), 0.7);
});

test("resolveConvictionScale: 점수 정보가 없으면 중립 1.0", () => {
  assert.equal(resolveConvictionScale({}), 1.0);
});
