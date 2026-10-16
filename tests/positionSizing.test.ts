import test from "node:test";
import assert from "node:assert/strict";
import {
  dailyVolatility,
  sizingLevel,
  stockSizing,
  SIZING_REFERENCE_VOL_RATIO,
  SIZING_VOL_WINDOW,
} from "../src/lib/positionSizing";

const zigzag = (n: number, amp: number) => Array.from({ length: n }, (_, i) => 100 * (i % 2 ? 1 + amp : 1));

test("dailyVolatility: 데이터 부족·비정상 값이면 null", () => {
  assert.equal(dailyVolatility(zigzag(SIZING_VOL_WINDOW, 0.02)), null);
  const bad = zigzag(80, 0.02);
  bad[70] = 0;
  assert.equal(dailyVolatility(bad), null);
  assert.equal(dailyVolatility(Array(80).fill(100)), null);
});

test("dailyVolatility: 흔들림이 큰 쪽이 크다, 최근 61개만 본다", () => {
  const small = dailyVolatility(zigzag(100, 0.01))!;
  const big = dailyVolatility(zigzag(100, 0.04))!;
  assert.ok(big > small * 3);
  // 오래된 구간에 큰 흔들림이 있어도 최근 창만 본다
  const mixed = [...zigzag(40, 0.2), ...zigzag(61, 0.01)];
  assert.ok(Math.abs(dailyVolatility(mixed)! - small) < 1e-9);
});

test("stockSizing: 보통 종목은 기준액(총액×10%÷5)", () => {
  const s = stockSizing({ totalValue: 50_000_000, satelliteMaxPct: 10, volRatio: SIZING_REFERENCE_VOL_RATIO, positionValue: 0 })!;
  assert.equal(s.baseAmount, 1_000_000);
  assert.equal(s.maxAmount, 1_000_000);
  assert.equal(s.level, "normal");
  assert.equal(s.overAmount, -1_000_000);
});

test("stockSizing: 흔들림 2배면 절반, 아주 잔잔해도 기준액 2배까지", () => {
  const big = stockSizing({ totalValue: 50_000_000, satelliteMaxPct: 10, volRatio: SIZING_REFERENCE_VOL_RATIO * 2, positionValue: 800_000 })!;
  assert.equal(big.maxAmount, 500_000);
  assert.equal(big.overAmount, 300_000);
  assert.equal(big.level, "large");
  const calm = stockSizing({ totalValue: 50_000_000, satelliteMaxPct: 10, volRatio: 0.5, positionValue: 0 })!;
  assert.equal(calm.maxAmount, 2_000_000);
  assert.equal(calm.level, "small");
});

test("stockSizing: 값이 없으면 null", () => {
  assert.equal(stockSizing({ totalValue: 0, satelliteMaxPct: 10, volRatio: 2, positionValue: 0 }), null);
  assert.equal(stockSizing({ totalValue: 1e7, satelliteMaxPct: 10, volRatio: null, positionValue: 0 }), null);
});

test("sizingLevel 경계", () => {
  assert.equal(sizingLevel(SIZING_REFERENCE_VOL_RATIO * 1.26), "large");
  assert.equal(sizingLevel(SIZING_REFERENCE_VOL_RATIO * 0.79), "small");
  assert.equal(sizingLevel(SIZING_REFERENCE_VOL_RATIO), "normal");
});
