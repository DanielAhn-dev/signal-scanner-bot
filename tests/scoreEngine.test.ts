import test from "node:test";
import assert from "node:assert/strict";
import type { StockOHLCV } from "../src/data/types";
import { calculateScore } from "../src/score/engine";

function buildSeries(length = 240): StockOHLCV[] {
  const out: StockOHLCV[] = [];
  for (let i = 0; i < length; i += 1) {
    const base = 100 + i * 0.35;
    const close = base + Math.sin(i / 12) * 1.2;
    out.push({
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      code: "005930",
      open: close * 0.995,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1_000_000 + i * 5000,
      amount: close * (1_000_000 + i * 5000),
    });
  }
  return out;
}

test("calculateScore: 정상 데이터면 점수 산출", () => {
  const result = calculateScore(buildSeries(), { vix: 18, fearGreed: 50, usdkrw: 1330 });
  assert.ok(result);
  assert.ok((result?.score ?? -1) >= 0);
  assert.ok((result?.score ?? 101) <= 100);
});

test("calculateScore: VIX 30 구간은 점수 페널티", () => {
  const baseData = buildSeries();
  const lowVix = calculateScore(baseData, { vix: 18, fearGreed: 50, usdkrw: 1330 });
  const highVix = calculateScore(baseData, { vix: 30, fearGreed: 50, usdkrw: 1330 });

  assert.ok(lowVix && highVix);
  assert.ok((highVix?.score ?? 0) < (lowVix?.score ?? 0));
});

test("calculateScore: 데이터 200봉 미만이면 null", () => {
  const result = calculateScore(buildSeries(120), { vix: 18, fearGreed: 50, usdkrw: 1330 });
  assert.equal(result, null);
});
