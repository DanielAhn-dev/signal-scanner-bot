import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCashSweepIdleAmount,
  resolveCashSweepTopUpQty,
  shouldLiquidateCashSweep,
  CASH_SWEEP_LIQUIDATE_THRESHOLD,
} from "../src/services/virtualAutoTradeCashSweep";

test("resolveCashSweepIdleAmount: 시드의 10% 초과 유휴현금만 스윕 대상이다", () => {
  // 시드 2천만원 → 예약분 200만원. 현금 300만원 → 유휴 100만원 (최소 50만원 이상이라 스윕)
  assert.equal(
    resolveCashSweepIdleAmount({ availableCash: 3_000_000, seedCapital: 20_000_000 }),
    1_000_000
  );
});

test("resolveCashSweepIdleAmount: 유휴현금이 최소 스윕금액(50만원) 미만이면 0을 반환한다", () => {
  // 예약분 200만원, 현금 220만원 → 유휴 20만원 < 최소 50만원
  assert.equal(
    resolveCashSweepIdleAmount({ availableCash: 2_200_000, seedCapital: 20_000_000 }),
    0
  );
});

test("resolveCashSweepIdleAmount: 시드가 0이면 스윕하지 않는다", () => {
  assert.equal(resolveCashSweepIdleAmount({ availableCash: 5_000_000, seedCapital: 0 }), 0);
});

test("shouldLiquidateCashSweep: 스윕 포지션이 없으면 현금화하지 않는다", () => {
  assert.equal(
    shouldLiquidateCashSweep({ availableCash: 0, sweepPositionValue: 0 }),
    false
  );
});

test("shouldLiquidateCashSweep: 실거래 현금이 임계값 미만이고 스윕 포지션이 있으면 현금화한다", () => {
  assert.equal(
    shouldLiquidateCashSweep({
      availableCash: CASH_SWEEP_LIQUIDATE_THRESHOLD - 1,
      sweepPositionValue: 1_000_000,
    }),
    true
  );
});

test("shouldLiquidateCashSweep: 실거래 현금이 임계값 이상이면 유지한다", () => {
  assert.equal(
    shouldLiquidateCashSweep({
      availableCash: CASH_SWEEP_LIQUIDATE_THRESHOLD,
      sweepPositionValue: 1_000_000,
    }),
    false
  );
});

test("resolveCashSweepTopUpQty: 부족분만큼만 매도 수량을 계산한다(전량 아님)", () => {
  // 필요 440만원, 보유현금 200만원 → 부족 240만원, 단가 107만원 → 3주(321만원)면 충분
  const qty = resolveCashSweepTopUpQty({
    cashNeeded: 4_400_000,
    availableCash: 2_000_000,
    sweepQty: 14,
    sweepPrice: 1_070_000,
  });
  assert.equal(qty, 3);
  assert.ok(qty < 14, "스윕 잔량 전체를 매도하면 안 된다");
});

test("resolveCashSweepTopUpQty: 이미 충분한 현금이 있으면 매도하지 않는다", () => {
  assert.equal(
    resolveCashSweepTopUpQty({
      cashNeeded: 1_000_000,
      availableCash: 2_000_000,
      sweepQty: 14,
      sweepPrice: 1_070_000,
    }),
    0
  );
});

test("resolveCashSweepTopUpQty: 스윕 보유수량을 넘겨서 매도하지 않는다", () => {
  assert.equal(
    resolveCashSweepTopUpQty({
      cashNeeded: 100_000_000,
      availableCash: 0,
      sweepQty: 14,
      sweepPrice: 1_070_000,
    }),
    14
  );
});
