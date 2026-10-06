import test from "node:test";
import assert from "node:assert/strict";
import {
  computeQualityMetrics,
  rankQualityPreference,
  QUALITY_PREF_MIN_POOL,
  type DailyHighClose,
} from "../src/services/qualityPreferenceSignal";

function series(n: number, f: (i: number) => number, wick = 1.01): DailyHighClose[] {
  return Array.from({ length: n }, (_, i) => ({ date: `d${i}`, close: f(i), high: f(i) * wick }));
}

test("데이터가 부족하면 계산하지 않는다", () => {
  assert.equal(computeQualityMetrics(series(100, () => 100)), null);
});

test("고가에 붙어 조용히 오르는 종목은 변동성 낮고 고가 근접도 높다", () => {
  const m = computeQualityMetrics(series(252, (i) => 100 + i * 0.1))!;
  assert.ok(m.vol20 < 0.002);
  assert.ok(m.nearHigh52 > 0.95);
});

test("흔들리고 고점에서 멀면 선호 지표가 나쁘다", () => {
  const calm = computeQualityMetrics(series(252, (i) => 100 + i * 0.1))!;
  const wild = computeQualityMetrics(series(252, (i) => (i < 200 ? 200 : 100 + (i % 2) * 10)))!;
  assert.ok(wild.vol20 > calm.vol20);
  assert.ok(wild.nearHigh52 < calm.nearHigh52);
});

test("후보가 적으면 순위를 매기지 않는다", () => {
  const m = new Map([["A", { vol20: 0.01, nearHigh52: 0.9 }]]);
  assert.equal(rankQualityPreference(m).size, 0);
});

test("선호 순위는 -3~+3 가산점으로 바뀌고 조용한 고가 근접 종목이 앞선다", () => {
  const m = new Map<string, { vol20: number; nearHigh52: number }>();
  const n = QUALITY_PREF_MIN_POOL + 2;
  for (let i = 0; i < n; i += 1) m.set(`C${i}`, { vol20: 0.01 + i * 0.002, nearHigh52: 0.99 - i * 0.02 });
  const r = rankQualityPreference(m);
  assert.equal(r.get("C0")!.boost, 3);
  assert.equal(r.get(`C${n - 1}`)!.boost, -3);
  assert.ok(r.get("C0")!.preference > r.get("C5")!.preference);
});
