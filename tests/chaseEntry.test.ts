import test from "node:test";
import assert from "node:assert/strict";
import { computeChaseEntry, CHASE_MIN_BARS, type DailyBar } from "../src/services/chaseEntrySignal";

function flat(n: number): DailyBar[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    open: 100,
    high: 101,
    close: 100,
    volume: 1000,
  }));
}

function withLast(bars: DailyBar[], last: Partial<DailyBar>): DailyBar[] {
  return [...bars.slice(0, -1), { ...bars[bars.length - 1], ...last }];
}

test("computeChaseEntry: 데이터가 부족하면 판단하지 않음", () => {
  assert.equal(computeChaseEntry(flat(CHASE_MIN_BARS - 1)), null);
});

test("computeChaseEntry: 평범한 날은 막지 않음", () => {
  assert.equal(computeChaseEntry(flat(25)), null);
});

test("computeChaseEntry: +8%·거래량 5배·고가 근처 마감이면 막음", () => {
  const r = computeChaseEntry(withLast(flat(25), { open: 100, high: 109, close: 108.5, volume: 6000 }));
  assert.ok(r);
  assert.ok(Math.abs(r.jump - 0.085) < 1e-9);
  assert.equal(r.volumeRatio, 6);
  assert.match(r.message, /추격 매수하지 않습니다/);
});

test("computeChaseEntry: 세 조건 중 하나라도 빠지면 막지 않음", () => {
  // 상승 폭 부족
  assert.equal(computeChaseEntry(withLast(flat(25), { high: 107.5, close: 107, volume: 6000 })), null);
  // 거래량 부족
  assert.equal(computeChaseEntry(withLast(flat(25), { high: 109, close: 108.5, volume: 4000 })), null);
  // 고가에서 밀려 마감(윗꼬리)
  assert.equal(computeChaseEntry(withLast(flat(25), { high: 120, close: 108.5, volume: 6000 })), null);
});

test("computeChaseEntry: 0·결측 값이 있으면 판단하지 않음", () => {
  const bars = withLast(flat(25), { high: 109, close: 108.5, volume: 6000 });
  bars[10] = { ...bars[10], volume: 0 };
  assert.equal(computeChaseEntry(bars), null);
});
