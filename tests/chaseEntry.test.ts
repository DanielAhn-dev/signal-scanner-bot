import test from "node:test";
import assert from "node:assert/strict";
import { computeChaseEntry, CHASE_MIN_BARS, type DailyBar } from "../src/services/chaseEntrySignal";

function flat(n: number): DailyBar[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, "0")}`,
    open: 100,
    high: 101,
    close: 100,
    volume: 1000,
  }));
}

/** k번째 뒤 봉(0=마지막)을 바꾼다. 급등 뒤 봉들은 급등 종가 근처로 맞춘다. */
function withSurge(n: number, daysAgo: number, surge: Partial<DailyBar>): DailyBar[] {
  const bars = flat(n);
  const i = n - 1 - daysAgo;
  bars[i] = { ...bars[i], ...surge };
  for (let k = i + 1; k < n; k += 1) bars[k] = { ...bars[k], close: surge.close ?? 100, high: (surge.close ?? 100) + 1 };
  return bars;
}

const SURGE = { open: 100, high: 109, close: 108.5, volume: 6000 };

test("computeChaseEntry: 데이터가 부족하면 판단하지 않음", () => {
  assert.equal(computeChaseEntry(flat(CHASE_MIN_BARS - 1)), null);
});

test("computeChaseEntry: 평범한 날은 막지 않음", () => {
  assert.equal(computeChaseEntry(flat(30)), null);
});

test("computeChaseEntry: +8%·거래량 5배·고가 근처 마감이면 막음", () => {
  const r = computeChaseEntry(withSurge(30, 0, SURGE));
  assert.ok(r);
  assert.equal(r.kind, "chase");
  assert.ok(Math.abs(r.jump - 0.085) < 1e-9);
  assert.equal(r.volumeRatio, 6);
  assert.match(r.message, /1일째/);
});

test("computeChaseEntry: 급등 뒤 5거래일까지 막고 6일째부터 풀림", () => {
  const r = computeChaseEntry(withSurge(30, 4, SURGE));
  assert.ok(r);
  assert.match(r.message, /5일째/);
  assert.equal(computeChaseEntry(withSurge(30, 5, SURGE)), null);
});

test("computeChaseEntry: 세 조건 중 하나라도 빠지면 막지 않음", () => {
  assert.equal(computeChaseEntry(withSurge(30, 0, { high: 107.5, close: 107, volume: 6000 })), null);
  assert.equal(computeChaseEntry(withSurge(30, 0, { high: 109, close: 108.5, volume: 4000 })), null);
  // 고가에서 크게 밀린 마감은 급등 추격이 아니라 긴 윗꼬리로 막힌다
  assert.equal(computeChaseEntry(withSurge(30, 0, { high: 120, close: 108.5, volume: 6000 }))?.kind, "wick");
});

test("computeChaseEntry: 한 달 -15% 이하면 떨어지는 칼날로 막음", () => {
  const bars = flat(30);
  for (let k = 9; k < 30; k += 1) bars[k] = { ...bars[k], close: 100 - (k - 8) * 0.8, high: 101 - (k - 8) * 0.8 };
  const r = computeChaseEntry(bars);
  assert.ok(r);
  assert.equal(r.kind, "knife");
  assert.ok(r.jump <= -0.15);
  assert.equal(r.volumeRatio, null);
});

test("computeChaseEntry: 한 달 -10%는 막지 않음", () => {
  const bars = flat(30);
  for (let k = 9; k < 30; k += 1) bars[k] = { ...bars[k], close: 100 - (k - 8) * 0.45, high: 101 - (k - 8) * 0.45 };
  assert.equal(computeChaseEntry(bars), null);
});

test("computeChaseEntry: 0·결측 값이 있으면 그 봉은 판단하지 않음", () => {
  const bars = withSurge(30, 0, SURGE);
  bars[20] = { ...bars[20], volume: 0 };
  assert.equal(computeChaseEntry(bars), null);
});

test("computeChaseEntry: 마지막 봉 고가가 종가보다 6% 이상 높으면 긴 윗꼬리로 막음", () => {
  const bars = flat(30);
  bars[29] = { ...bars[29], high: 107, close: 100 };
  const r = computeChaseEntry(bars);
  assert.ok(r);
  assert.equal(r.kind, "wick");
  assert.ok(Math.abs(r.jump - 0.07) < 1e-9);
});

test("computeChaseEntry: 윗꼬리 5%는 막지 않고, 그 전날 윗꼬리는 보지 않음", () => {
  const bars = flat(30);
  bars[29] = { ...bars[29], high: 105, close: 100 };
  assert.equal(computeChaseEntry(bars), null);
  const prev = flat(30);
  prev[28] = { ...prev[28], high: 110, close: 100 };
  assert.equal(computeChaseEntry(prev), null);
});
