import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDailyDistribution, type DailyBar } from "../src/services/dataDistributionCheck";

const prev: DailyBar[] = Array.from({ length: 100 }, (_, i) => ({ ticker: `T${i}`, close: 1000 + i, volume: 10_000 + i }));

test("분포 점검: 정상적인 하루는 이슈 없음", () => {
  const latest = prev.map((b, i) => ({ ...b, close: b.close! * (1 + (i % 7 - 3) / 100), volume: b.volume! * 1.1 }));
  assert.deepEqual(evaluateDailyDistribution(latest, prev).issues, []);
});

test("분포 점검: 종가 동결·거래량 0·단위 변경을 잡는다", () => {
  const frozen = prev.map((b) => ({ ...b }));
  assert.ok(evaluateDailyDistribution(frozen, prev).issues.some((m) => m.includes("동결")));
  const zero = prev.map((b) => ({ ...b, close: b.close! * 1.01, volume: 0 }));
  assert.ok(evaluateDailyDistribution(zero, prev).issues.some((m) => m.includes("거래량 0")));
  const scaled = prev.map((b) => ({ ...b, close: b.close! * 10, volume: b.volume! / 100 }));
  const issues = evaluateDailyDistribution(scaled, prev).issues;
  assert.ok(issues.some((m) => m.includes("단위")));
});

test("분포 점검: 표본이 적으면 판정하지 않는다", () => {
  assert.deepEqual(evaluateDailyDistribution(prev.slice(0, 10), prev.slice(0, 10)).issues, []);
});
