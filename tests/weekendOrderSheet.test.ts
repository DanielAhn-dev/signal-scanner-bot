import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderSheetLines, formatOrderSheetText } from "../src/services/weekendOrderSheet";
import { simulateOrderSheetStrategy, type DailyBar } from "../src/services/strategyForwardTest";

const base = { code: "000001", name: "테스트", currentPrice: 10_130, entryLow: 9_800, entryHigh: 10_040, stopPrice: 9_310, target1: 10_880 };

test("buildOrderSheetLines: 호가단위 보정·1차 예산 수량, 수량 0·가격 역전 후보는 제외", () => {
  const lines = buildOrderSheetLines([
    { ...base, trancheBudget: 2_000_000 },
    { ...base, code: "000002", currentPrice: 3_000_000, entryHigh: 3_000_000, stopPrice: 2_800_000, target1: 3_200_000, trancheBudget: 2_000_000 },
    { ...base, code: "000003", target1: 9_000, trancheBudget: 2_000_000 },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].limitPrice, 10_040);
  assert.equal(lines[0].quantity, 199);
  assert.equal(lines[0].takeProfitPrice, 10_880);
  assert.equal(lines[0].stopPrice, 9_310);
  assert.match(formatOrderSheetText({ dateLabel: "2026-10-02", cashLabel: "100원", lines }), /매수 지정가 10,040원 × 199주/);
  assert.match(formatOrderSheetText({ dateLabel: "d", cashLabel: "c", lines: [] }), /현금 대기/);
});

function bars(rows: Array<[string, number, number, number, number]>): Map<string, DailyBar> {
  return new Map(rows.map(([date, open, high, low, close]) => [date, { date, open, high, low, close, volume: 1 }]));
}

test("simulateOrderSheetStrategy: 지정가 체결 후 익절, 미체결 슬롯은 CD금리, 같은 날 손절·익절은 손절 우선", () => {
  const tradingDates = ["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
  const sheet = {
    asof: "2026-10-02",
    lines: [
      { code: "A", limitPrice: 100, takeProfitPrice: 110, stopPrice: 93 },
      { code: "B", limitPrice: 100, takeProfitPrice: 110, stopPrice: 93 },
      { code: "C", limitPrice: 100, takeProfitPrice: 110, stopPrice: 93 },
    ],
  };
  const barsByCode = new Map([
    // A: 월 저가 99 체결(지정가 100) → 수 고가 111 익절 110
    ["A", bars([["2026-10-05", 103, 104, 99, 102], ["2026-10-06", 102, 105, 101, 104], ["2026-10-07", 105, 111, 104, 109]])],
    // B: 한 번도 100 아래로 안 옴 → 미체결
    ["B", bars([["2026-10-05", 105, 108, 101, 106], ["2026-10-09", 107, 109, 104, 108]])],
    // C: 월 시가 98 체결 → 화 저가 92·고가 112 → 손절 93
    ["C", bars([["2026-10-05", 98, 99, 97, 98], ["2026-10-06", 100, 112, 92, 101]])],
  ]);
  const r = simulateOrderSheetStrategy({ sheets: [sheet], tradingDates, barsByCode, slots: 5 });
  assert.equal(r.periods, 1);
  // A +10%, C (93/98-1)≈-5.1%, 나머지 3슬롯 CD ≈ +0.05% → 평균 ≈ +0.9% (비용 차감)
  assert.ok(r.totalReturnPct > 0.6 && r.totalReturnPct < 1.1, `total ${r.totalReturnPct}`);
});
