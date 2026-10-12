import test from "node:test";
import assert from "node:assert/strict";
import { computeDropDayContext, DROP_DAY_FLOW_WINDOW } from "../src/services/dropDayContext";

const closes = [
  { date: "2025-12-30", close: 100 },
  { date: "2026-01-02", close: 110 }, // 고점
  { date: "2026-01-05", close: 107 }, // -2.73%
  { date: "2026-01-06", close: 108 }, // +
  { date: "2026-01-07", close: 106 }, // -1.85%
  { date: "2026-01-08", close: 104 }, // -1.89%
];

test("연속 하락·고점 대비·올해 하락 횟수", () => {
  const c = computeDropDayContext({ closes, flows: [] })!;
  assert.equal(c.asOf, "2026-01-08");
  assert.equal(c.downStreak, 2);
  assert.ok(Math.abs(c.fromHighPct - (104 / 110 - 1) * 100) < 1e-9);
  // 2026년: -2.73, -1.85, -1.89 → ≤-1.5 세 번, ≤-2 한 번. 2025-12-30→2026-01-02(+10%)는 급등 한 번
  assert.deepEqual(c.yearCounts, { "-1.5": 3, "-2": 1, "-3": 0, "-5": 0, "+3": 1 });
  assert.equal(c.newHigh52w, false); // 직전 자료 250일 미만
  assert.equal(c.foreign, null);
});

test("실시간 값: 같은 날이면 바꾸고, 다음 날이면 덧붙인다", () => {
  const same = computeDropDayContext({ closes, flows: [], live: { date: "2026-01-08", price: 100 } })!;
  assert.ok(Math.abs(same.changePct - (100 / 106 - 1) * 100) < 1e-9);
  const next = computeDropDayContext({ closes, flows: [], live: { date: "2026-01-09", price: 102 } })!;
  assert.equal(next.asOf, "2026-01-09");
  assert.equal(next.downStreak, 3);
});

test("휴장일·장 시작 전: 실시간 가격이 마지막 종가와 같으면 0% 하루를 만들지 않는다", () => {
  const c = computeDropDayContext({ closes, flows: [], live: { date: "2026-01-10", price: 104 } })!;
  assert.equal(c.asOf, "2026-01-08");
  assert.equal(c.downStreak, 2);
});

test("외국인: 오늘 자료가 있을 때만 최근 250일 위치를 낸다", () => {
  const flows = Array.from({ length: DROP_DAY_FLOW_WINDOW }, (_, i) => ({ date: `2025-${String(i).padStart(5, "0")}`, foreignNet: i }));
  const today = computeDropDayContext({ closes, flows: [...flows, { date: "2026-01-08", foreignNet: -5 }] })!;
  assert.deepEqual(today.foreign, { date: "2026-01-08", net: -5, rank: 0 });
  const stale = computeDropDayContext({ closes, flows: [...flows, { date: "2026-01-07", foreignNet: -5 }] })!;
  assert.equal(stale.foreign, null);
});

test("종가가 2개 미만이면 null", () => {
  assert.equal(computeDropDayContext({ closes: closes.slice(0, 1), flows: [] }), null);
});

test("52주 신고가: 직전 250거래일 최고 종가 이상일 때만", () => {
  const base = Array.from({ length: 260 }, (_, i) => ({ date: `2025-${String(i).padStart(5, "0")}`, close: i === 100 ? 200 : 100 }));
  const below = computeDropDayContext({ closes: [...base, { date: "2026-01-02", close: 199 }], flows: [] })!;
  assert.equal(below.newHigh52w, false);
  const at = computeDropDayContext({ closes: [...base, { date: "2026-01-02", close: 200 }], flows: [] })!;
  assert.equal(at.newHigh52w, true);
});
