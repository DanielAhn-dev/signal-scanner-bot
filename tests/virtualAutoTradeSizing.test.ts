import test from "node:test";
import assert from "node:assert/strict";
import { calculateAutoTradeBuySizing } from "../src/services/virtualAutoTradeSizing";

test("calculateAutoTradeBuySizing: 기본 분할횟수 3회를 적용해 1차 진입 금액을 계산한다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 20_000_000,
    price: 50_000,
    slotsLeft: 2,
    currentHoldingCount: 0,
    maxPositions: 8,
    stopLossPct: 4,
    prefs: {
      capital_krw: 20_000_000,
      risk_profile: "safe",
    },
  });

  assert.equal(result.targetPositions, 6);
  assert.equal(result.splitCount, 3);
  assert.equal(result.budgetPerSlot, 10_000_000);
  assert.equal(result.budgetPerTargetPosition, 3_333_333);
  assert.equal(result.maxBudgetByRisk, 3_750_000);
  assert.equal(result.totalBudget, 3_333_333);
  assert.equal(result.budget, 1_111_111);
  assert.equal(result.quantity, 22);
  assert.equal(result.investedAmount, 1_100_000);
});

test("calculateAutoTradeBuySizing: split_count 1이면 총 목표 예산을 한 번에 사용한다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 12_000_000,
    price: 30_000,
    slotsLeft: 2,
    currentHoldingCount: 2,
    maxPositions: 8,
    stopLossPct: 4,
    prefs: {
      capital_krw: 20_000_000,
      risk_profile: "safe",
      virtual_target_positions: 8,
      split_count: 1,
    },
  });

  assert.equal(result.targetPositions, 8);
  assert.equal(result.splitCount, 1);
  assert.equal(result.budgetPerTargetPosition, 2_000_000);
  assert.equal(result.totalBudget, 2_000_000);
  assert.equal(result.budget, 2_000_000);
  assert.equal(result.quantity, 66);
});

test("calculateAutoTradeBuySizing: 사용자 분할횟수가 있으면 회당 진입 금액을 더 줄인다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 12_000_000,
    price: 30_000,
    slotsLeft: 2,
    currentHoldingCount: 2,
    maxPositions: 8,
    stopLossPct: 4,
    prefs: {
      capital_krw: 20_000_000,
      risk_profile: "safe",
      virtual_target_positions: 8,
      split_count: 4,
    },
  });

  assert.equal(result.splitCount, 4);
  assert.equal(result.totalBudget, 2_000_000);
  assert.equal(result.budget, 500_000);
  assert.equal(result.quantity, 16);
});

test("calculateAutoTradeBuySizing: 현금이 부족하면 0주를 반환한다", () => {
  const result = calculateAutoTradeBuySizing({
    availableCash: 40_000,
    price: 50_000,
    slotsLeft: 1,
    currentHoldingCount: 0,
    maxPositions: 8,
    stopLossPct: 4,
    prefs: {
      capital_krw: 20_000_000,
      risk_profile: "safe",
    },
  });

  assert.equal(result.quantity, 0);
  assert.equal(result.investedAmount, 0);
});