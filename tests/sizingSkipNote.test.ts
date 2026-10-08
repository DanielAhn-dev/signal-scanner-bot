import test from "node:test";
import assert from "node:assert/strict";
import { calculateAutoTradeBuySizing, describeSizingSkips } from "../src/services/virtualAutoTradeSizing";

test("최소현금을 남긴 쓸 돈이 한 종목 최소 금액보다 적으면 '현금 부족'이 아니라 그 이유를 쓴다", () => {
  // 2026-10-08: 쓸 수 있는 돈 약 96만원, 종목당 목표 약 200만원(최소 100만원)
  const sizing = calculateAutoTradeBuySizing({
    availableCash: 959_864,
    price: 265_765,
    slotsLeft: 2,
    currentHoldingCount: 8,
    maxPositions: 10,
    stopLossPct: 10,
    prefs: { virtual_seed_capital: 10_000_000, virtual_target_positions: 5 } as any,
  });
  assert.equal(sizing.quantity, 0);
  assert.equal(sizing.skipReason, "below-meaningful-size");
  assert.equal(sizing.cashLimited, true);
  const note = describeSizingSkips([sizing, sizing], 25);
  assert.equal(
    note,
    "매수 보류 2건: 최소현금 25%를 남기고 쓸 수 있는 돈 959,864원이 한 종목 최소 매수 금액 1,000,000원보다 적음 (작은 매수 방지)"
  );
});

test("손실 뒤 축소로 작아진 경우는 쓸 돈이 아니라 축소를 이유로 쓴다", () => {
  const sizing = calculateAutoTradeBuySizing({
    availableCash: 5_000_000,
    price: 50_000,
    slotsLeft: 2,
    currentHoldingCount: 3,
    maxPositions: 10,
    stopLossPct: 10,
    riskBudgetScale: 0.3,
    prefs: { virtual_seed_capital: 10_000_000, virtual_target_positions: 5 } as any,
  });
  assert.equal(sizing.cashLimited, false);
  assert.match(describeSizingSkips([sizing], 25) ?? "", /손실·위험 한도로 줄인 매수 금액/);
});

test("보류가 없으면 줄을 쓰지 않는다", () => {
  assert.equal(describeSizingSkips([], 25), null);
});
