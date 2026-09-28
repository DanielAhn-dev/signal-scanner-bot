import test from "node:test";
import assert from "node:assert/strict";
import { firstTradingDaysOfWeeks, simulateWeeklyStrategy, type DailyBar } from "../src/services/strategyForwardTest";

test("firstTradingDaysOfWeeks: 월요일이 휴장이면 그 주 첫 거래일", () => {
  assert.deepEqual(
    firstTradingDaysOfWeeks(["2026-09-22", "2026-09-23", "2026-09-28", "2026-09-29", "2026-10-06", "2026-10-07"]),
    ["2026-09-22", "2026-09-28", "2026-10-06"]
  );
});

test("simulateWeeklyStrategy: 시가→다음 주 시가 수익에서 교체 비용을 뺀다", () => {
  const bar = (date: string, open: number): DailyBar => ({ date, open, close: open, volume: 1 });
  const barsByCode = new Map([
    ["A", new Map([["d0", bar("d0", 100)], ["d1", bar("d1", 110)]])],
  ]);
  const r = simulateWeeklyStrategy({ name: "score-top5", rebalanceDates: ["d0", "d1"], pick: () => ["A"], barsByCode });
  // +10% − 신규 편입 비용(편도 0.225% × 2 × 회전율 0.5 = 0.225%)
  assert.ok(Math.abs(r.totalReturnPct - (10 - 0.225)) < 1e-9);
});
