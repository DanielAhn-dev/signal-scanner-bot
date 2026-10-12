import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCashSweepIdleAmount,
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


test("resolveCashSweepIdleAmount: 개별주 보유분만큼 개별주용 현금이 줄어 나머지는 지수로 간다", () => {
  // 시드 2천만의 10%(200만) 중 개별주가 150만 → 개별주용 현금 50만, 현금 300만 중 250만이 지수로
  assert.equal(
    resolveCashSweepIdleAmount({ availableCash: 3_000_000, seedCapital: 20_000_000, satelliteValue: 1_500_000 }),
    2_500_000
  );
  // 개별주가 몫을 넘으면 현금 전부가 지수로 (지수를 팔아 개별주를 채우지 않으므로 반대 방향은 없다)
  assert.equal(
    resolveCashSweepIdleAmount({ availableCash: 1_200_000, seedCapital: 20_000_000, satelliteValue: 5_000_000 }),
    1_200_000
  );
});

test("resolveCashSweepIdleAmount: 월 입금액은 최소 스윕금액(100만원) 미만이어도 지수로 산다", () => {
  assert.equal(
    resolveCashSweepIdleAmount({ availableCash: 2_500_000, seedCapital: 20_000_000, depositAmount: 500_000 }),
    500_000
  );
  // 현금보다 많이 사지 않는다
  assert.equal(
    resolveCashSweepIdleAmount({ availableCash: 300_000, seedCapital: 20_000_000, depositAmount: 500_000 }),
    300_000
  );
  // 유휴현금이 입금액보다 크면 유휴현금 전부
  assert.equal(
    resolveCashSweepIdleAmount({ availableCash: 4_000_000, seedCapital: 20_000_000, depositAmount: 500_000 }),
    2_000_000
  );
});

test("스윕 후보 ETF: 지수형·금리형 모두 보유분 조회 대상", () => {
  for (const code of [...INDEX_SWEEP_CODES, ...RATE_SWEEP_CODES]) assert.ok(CASH_SWEEP_CANDIDATE_CODES.includes(code));
});
