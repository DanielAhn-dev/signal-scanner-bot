import test from "node:test";
import assert from "node:assert/strict";
import { resolveBatchDay, expectedTradingDay } from "../src/services/batchVerifyDay";

test("정시 실행(금 18:40 KST)은 같은 날이 기준일", () => {
  assert.equal(resolveBatchDay(new Date("2026-10-02T09:40:00Z")), "2026-10-02");
});

test("자정을 넘겨 끝난 금요일 배치(토 01:28 KST)도 금요일이 기대 거래일", () => {
  assert.equal(expectedTradingDay(new Date("2026-10-02T16:28:48Z")), "2026-10-02");
});

test("휴장일(2026-10-05 대체공휴일)에 돈 배치는 직전 거래일(10-02)을 기대 거래일로 본다", () => {
  assert.equal(expectedTradingDay(new Date("2026-10-05T09:20:00Z")), "2026-10-02");
  assert.equal(expectedTradingDay(new Date("2026-10-05T18:43:00Z")), "2026-10-02");
});

test("평일 정시 실행은 당일", () => {
  assert.equal(expectedTradingDay(new Date("2026-10-01T09:30:00Z")), "2026-10-01");
});
