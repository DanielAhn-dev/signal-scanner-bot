import test from "node:test";
import assert from "node:assert/strict";
import {
  firstTradingDaysOfWeeks,
  simulateWeeklyStrategy,
  simulateIndexStrategies,
  buildDistributionNetPerShareByDate,
  type DailyBar,
} from "../src/services/strategyForwardTest";
import { exDividendDate, computeDistributionCredit, type EtfDistribution } from "../src/services/etfDistribution";

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

test("buildDistributionNetPerShareByDate: 분배락일에 세후 주당 금액을 매핑", () => {
  const d: EtfDistribution = { code: "069500", recordDate: "2026-06-26", payDate: "2026-07-05", perShare: 855, taxablePerShare: 855 };
  const map = buildDistributionNetPerShareByDate([d]);
  assert.equal(map.size, 1);
  assert.equal(map.get(exDividendDate(d.recordDate)), computeDistributionCredit(d, 1).net);
});

test("simulateIndexStrategies: kodex200-hold는 가격수익률에 세후 분배금을 더한다", () => {
  const bars: DailyBar[] = [
    { date: "d0", open: 1000, close: 1000, volume: 1 },
    { date: "d1", open: 1000, close: 1000, volume: 1 }, // 가격은 그대로, 이날 분배금 지급
  ];
  const dist = new Map([["d1", 50]]); // 세후 주당 50원 = 5%
  const [, hold] = simulateIndexStrategies({ index: bars, startDate: "d1", distributionNetPerShareByDate: dist });
  assert.ok(Math.abs(hold.totalReturnPct - 5) < 1e-9);
});

test("simulateIndexStrategies: index-core는 지수를 들고 있을 때만 분배금을 받는다 (SMA 미형성 시 CD 보유 → 분배금 제외)", () => {
  const bars: DailyBar[] = [
    { date: "d0", open: 1000, close: 1000, volume: 1 },
    { date: "d1", open: 1000, close: 1000, volume: 1 },
  ];
  const dist = new Map([["d1", 50]]);
  const [core] = simulateIndexStrategies({ index: bars, startDate: "d1", distributionNetPerShareByDate: dist });
  // SMA50을 계산할 과거 봉이 없어 wantIndex=false → CD 보유 → 분배금 5%가 반영되면 안 된다
  assert.ok(Math.abs(core.totalReturnPct - 5) > 1e-6);
});

test("simulateIndexStrategies: 실제 CD 시세가 있으면 고정 CD_ANNUAL 대신 그 수익률을 쓴다", () => {
  const bars: DailyBar[] = [
    { date: "d0", open: 1000, close: 1000, volume: 1 },
    { date: "d1", open: 1000, close: 1000, volume: 1 }, // 지수는 변화 없음 → SMA 미형성으로 CD 보유
  ];
  const cd: DailyBar[] = [
    { date: "d0", open: 100, close: 100, volume: 1 },
    { date: "d1", open: 100, close: 102, volume: 1 }, // 실제 CD ETF는 이 기간 2% 상승
  ];
  const [core, , cdOnly] = simulateIndexStrategies({ index: bars, startDate: "d1", cd });
  assert.ok(Math.abs(cdOnly.totalReturnPct - 2) < 1e-9);
  assert.ok(Math.abs(core.totalReturnPct - 2) < 1e-9);
});
