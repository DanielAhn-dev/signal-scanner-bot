import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCashSweepIdleAmount,
  resolveCashSweepTopUpQty,
  resolveCashSweepRestoreQty,
  shouldLiquidateCashSweep,
  CASH_SWEEP_LIQUIDATE_THRESHOLD,
  INDEX_SWEEP_CODES,
  RATE_SWEEP_CODES,
  CASH_SWEEP_CANDIDATE_CODES,
} from "../src/services/virtualAutoTradeCashSweep";

test("resolveCashSweepIdleAmount: 시드의 10% 초과 유휴현금만 스윕 대상이다", () => {
  assert.equal(
    resolveCashSweepIdleAmount({ availableCash: 3_000_000, seedCapital: 20_000_000 }),
    1_000_000
  );
});

test("resolveCashSweepIdleAmount: 유휴현금이 최소 스윕금액(100만원) 미만이면 0을 반환한다", () => {
  assert.equal(
    resolveCashSweepIdleAmount({ availableCash: 2_999_999, seedCapital: 20_000_000 }),
    0
  );
  assert.equal(resolveCashSweepIdleAmount({ availableCash: 3_000_000, seedCapital: 20_000_000 }), 1_000_000);
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

test("스윕 후보 ETF: 지수형·금리형 모두 보유분 조회 대상", () => {
  for (const code of [...INDEX_SWEEP_CODES, ...RATE_SWEEP_CODES]) assert.ok(CASH_SWEEP_CANDIDATE_CODES.includes(code));
});

test("resolveCashSweepTopUpQty: 매수 뒤에도 청산 임계값만큼 현금이 남게 판다(보충 직후 전량 청산 방지)", () => {
  // 2026-10-06: 필요 160만원, 현금 40만원, 단가 11.2만원 — 부족분(120만원)만 팔면 매수 뒤 현금 ≈0 → 청산 점검에 걸림
  const qty = resolveCashSweepTopUpQty({ cashNeeded: 1_600_000, availableCash: 400_000, sweepQty: 56, sweepPrice: 112_000 });
  const cashAfterBuy = 400_000 + qty * 112_000 - 1_600_000;
  assert.ok(cashAfterBuy >= CASH_SWEEP_LIQUIDATE_THRESHOLD, `매수 뒤 현금 ${cashAfterBuy}`);
  assert.equal(shouldLiquidateCashSweep({ availableCash: cashAfterBuy, sweepPositionValue: (56 - qty) * 112_000 }), false);
});

test("resolveCashSweepRestoreQty: 현금 부족 시 예비 현금(시드 10%)을 채울 만큼만 판다", () => {
  // 시드 2천만 → 예비 200만원. 현금 5만원이면 195만원 필요 → 단가 11.2만원 18주 (보유 45주 전량이 아님)
  const qty = resolveCashSweepRestoreQty({ availableCash: 50_000, seedCapital: 20_000_000, sweepQty: 45, sweepPrice: 112_000 });
  assert.equal(qty, 18);
  // 판 뒤 남는 현금은 예비 현금 수준이라 다음 회차 유휴현금 재매수가 생기지 않는다
  const cashAfter = 50_000 + qty * 112_000;
  assert.equal(resolveCashSweepIdleAmount({ availableCash: cashAfter, seedCapital: 20_000_000 }), 0);
});

test("resolveCashSweepRestoreQty: 예비 현금 이상이거나 시드·가격이 없으면 0, 보유 수량을 넘지 않는다", () => {
  assert.equal(resolveCashSweepRestoreQty({ availableCash: 2_000_000, seedCapital: 20_000_000, sweepQty: 45, sweepPrice: 112_000 }), 0);
  assert.equal(resolveCashSweepRestoreQty({ availableCash: 0, seedCapital: 0, sweepQty: 45, sweepPrice: 112_000 }), 0);
  assert.equal(resolveCashSweepRestoreQty({ availableCash: 0, seedCapital: 20_000_000, sweepQty: 5, sweepPrice: 112_000 }), 5);
});
