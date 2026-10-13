import test from "node:test";
import assert from "node:assert/strict";
import { computePeakSinceBuy, evaluatePeakGiveback } from "../src/lib/peakGiveback";

const series = [
  { date: "2026-09-30", close: 200 },
  { date: "2026-10-01", close: 100 },
  { date: "2026-10-05", close: 132 },
  { date: "2026-10-08", close: 110 },
];

test("고점: 매수일 당일부터, 매수 전 고점은 보지 않는다", () => {
  assert.deepEqual(computePeakSinceBuy(series, "2026-10-01", 108, "2026-10-13"), { price: 132, date: "2026-10-05" });
  // 오늘 실시간가가 더 높으면 오늘이 고점
  assert.deepEqual(computePeakSinceBuy(series, "2026-10-01", 140, "2026-10-13"), { price: 140, date: "2026-10-13" });
  assert.equal(computePeakSinceBuy([], "2026-10-01", null, "2026-10-13"), null);
});

test("내준 폭: +32% → +8%는 고점 대비 −18%로 경고, −15% 미만은 경고 아님", () => {
  const g = evaluatePeakGiveback({ avgPrice: 100, currentPrice: 108, peakPrice: 132 })!;
  assert.ok(Math.abs(g.peakGainPct - 32) < 1e-9);
  assert.ok(Math.abs(g.nowGainPct - 8) < 1e-9);
  assert.ok(Math.abs(g.fromPeakPct - (108 / 132 - 1) * 100) < 1e-9);
  assert.equal(g.alert, true);
  assert.equal(evaluatePeakGiveback({ avgPrice: 100, currentPrice: 115, peakPrice: 132 })!.alert, false);
});

test("내준 폭: 고점이 평단 아래였거나 값이 없으면 계산하지 않는다", () => {
  assert.equal(evaluatePeakGiveback({ avgPrice: 100, currentPrice: 80, peakPrice: 100 }), null);
  assert.equal(evaluatePeakGiveback({ avgPrice: null, currentPrice: 80, peakPrice: 120 }), null);
  assert.equal(evaluatePeakGiveback({ avgPrice: 100, currentPrice: 0, peakPrice: 120 }), null);
});
