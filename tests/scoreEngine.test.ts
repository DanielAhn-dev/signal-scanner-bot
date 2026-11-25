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

test("calculateScore: VIX·공포탐욕·환율은 점수를 바꾸지 않는다 (2026-11-23 정리)", () => {
  const baseData = buildSeries();
  const calm = calculateScore(baseData, { vix: 18, fearGreed: 50, usdkrw: 1330 });
  const stress = calculateScore(baseData, { vix: 35, fearGreed: 10, usdkrw: 1450 });

  assert.ok(calm && stress);
  assert.equal(stress?.score, calm?.score);
  assert.equal(stress?.factors.market_adj, 0);
});

test("calculateScore: 데이터 200봉 미만이면 null", () => {
  const result = calculateScore(buildSeries(120), { vix: 18, fearGreed: 50, usdkrw: 1330 });
  assert.equal(result, null);
});

test("calculateScore: 외국인/기관 연속 순매수·대규모 순매도는 점수를 바꾸지 않는다 (C27, 2026-11-23 정리)", () => {
  const baseData = buildSeries();
  const neutral = calculateScore(baseData, { vix: 18, fearGreed: 50, usdkrw: 1330 });
  const inflow = calculateScore(baseData, {
    investorFlow: {
      foreign5d: 8_500_000_000,
      institution5d: 3_200_000_000,
      foreignConsecutiveBuyDays: 5,
      institutionConsecutiveBuyDays: 3,
    },
  });
  const outflow = calculateScore(baseData, {
    investorFlow: {
      foreign5d: -6_200_000_000,
      institution5d: -3_500_000_000,
      foreignConsecutiveBuyDays: 0,
      institutionConsecutiveBuyDays: 0,
    },
  });

  assert.ok(neutral && inflow && outflow);
  assert.equal(inflow?.score, neutral?.score);
  assert.equal(outflow?.score, neutral?.score);
  assert.notEqual(outflow?.factors.institutional_signal, "distribution");
});

test("calculateScore: Stable Pro 팩터(stable_turn/trust)가 산출된다", () => {
  const result = calculateScore(buildSeries(), { vix: 18, fearGreed: 50, usdkrw: 1330 });
  assert.ok(result);
  assert.ok(result?.factors.stable_turn);
  assert.ok(Number.isFinite(Number(result?.factors.stable_turn_trust ?? NaN)));
  assert.ok(typeof result?.factors.stable_above_avg === "boolean");
});
