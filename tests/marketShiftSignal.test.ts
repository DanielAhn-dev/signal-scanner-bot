import assert from "node:assert/strict";
import test from "node:test";
import { computeMarketShift, type MarketShiftDay } from "../src/services/marketShiftSignal";

function makeDays(n: number, fn: (i: number) => Partial<MarketShiftDay> & { close: number }): MarketShiftDay[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `d${String(i).padStart(4, "0")}`,
    foreignNet: 0,
    breadthRatio: 0.5,
    ...fn(i),
  }));
}

test("종가가 80일 미만이면 null", () => {
  assert.equal(computeMarketShift(makeDays(79, () => ({ close: 100 }))), null);
});

test("과거가 120개 미만이면 위치를 내지 않는다", () => {
  const r = computeMarketShift(makeDays(100, (i) => ({ close: 100 + i })))!;
  assert.ok(r.indicators.every((x) => x.rank == null));
  assert.equal(r.unusualCount, 0);
});

test("꾸준히 오르다 마지막에 급등하면 이격도가 상위 10%에 들어 평소와 다름", () => {
  const days = makeDays(400, (i) => ({ close: i < 399 ? 100 + (i % 7) : 140 }));
  const gap = computeMarketShift(days)!.indicators.find((x) => x.key === "gap60")!;
  assert.ok((gap.rank as number) >= 0.9);
  assert.equal(gap.unusual, true);
});

test("외국인·시장 폭 자료가 없으면 해당 지표만 빠진다", () => {
  const days = makeDays(400, (i) => ({ close: 100 + Math.sin(i / 5) * 3, foreignNet: null, breadthRatio: null }));
  const r = computeMarketShift(days)!;
  const byKey = Object.fromEntries(r.indicators.map((x) => [x.key, x]));
  assert.equal(byKey.foreign20.rank, null);
  assert.equal(byKey.breadth.rank, null);
  assert.notEqual(byKey.gap60.rank, null);
  assert.notEqual(byKey.vol20.rank, null);
});

test("외국인 순매도가 마지막 20일 몰리면 낮음·하락 방향", () => {
  const days = makeDays(400, (i) => ({ close: 100 + Math.sin(i / 5), foreignNet: i >= 380 ? -3000 : ((i * 7) % 11) - 5 + (i % 40 < 20 ? 6 : -6) }));
  const f = computeMarketShift(days)!.indicators.find((x) => x.key === "foreign20")!;
  assert.ok((f.rank as number) <= 0.1);
  assert.equal(f.unusual, true);
  assert.equal(f.move, "down");
});

test("오늘 수급·시장 폭 행이 아직 없으면 직전 거래일 값으로 계산한다", () => {
  const days = makeDays(400, (i) => ({
    close: 100 + Math.sin(i / 5) * 3,
    foreignNet: i === 399 ? null : Math.sin(i) * 100,
    breadthRatio: i === 399 ? null : 0.5 + Math.sin(i) * 0.1,
  }));
  const r = computeMarketShift(days)!;
  const f = r.indicators.find((x) => x.key === "foreign20")!;
  const b = r.indicators.find((x) => x.key === "breadth")!;
  assert.notEqual(f.rank, null);
  assert.notEqual(b.rank, null);
  assert.equal(f.asOf, days[398].date);
  assert.equal(r.indicators.find((x) => x.key === "gap60")!.asOf, days[399].date);
});

test("안내 문구에 하락 확률 같은 예측 표현을 쓰지 않는다", () => {
  const days = makeDays(400, (i) => ({ close: 100 + Math.sin(i / 5) * 3, foreignNet: Math.sin(i), breadthRatio: 0.5 + Math.sin(i) * 0.01 }));
  const r = computeMarketShift(days)!;
  assert.ok(r.message.length > 0);
  assert.ok(!r.message.includes("하락 확률"));
});
