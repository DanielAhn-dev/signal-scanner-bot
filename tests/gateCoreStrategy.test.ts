import test from "node:test";
import assert from "node:assert/strict";
import {
  isGateCoreRebalanceDue,
  planGateCoreRebalance,
  resolveGateCoreSlotBudget,
  selectGateCoreTargets,
} from "../src/services/gateCoreStrategy";
import { simulateGateCore, type DailyBar } from "../src/services/strategyForwardTest";
import { resolveActivationState } from "../src/services/strategyPromotion";

test("selectGateCoreTargets: 점수 순서대로 관문 통과 + 1주 살 수 있는 종목만", () => {
  const targets = selectGateCoreTargets({
    rankedCodes: ["A", "B", "C", "D", "E"],
    gatePass: new Set(["A", "C", "D", "E"]),
    prices: new Map([["A", 50_000], ["C", 2_000_000], ["D", 10_000], ["E", 20_000]]),
    slotBudget: 900_000,
    slots: 2,
  });
  // B는 관문 탈락, C는 1주 가격이 칸 예산 초과 → A, D
  assert.deepEqual(targets, ["A", "D"]);
  assert.equal(resolveGateCoreSlotBudget(20_000_000), 900_000);
});

test("planGateCoreRebalance: 빠진 종목 매도, 50일선 아래면 새로 사지 않음", () => {
  const up = planGateCoreRebalance({ heldCodes: ["A", "X"], targets: ["A", "B", "C"], trendUp: true, slots: 3 });
  assert.deepEqual(up, { sell: ["X"], keep: ["A"], buy: ["B", "C"] });
  const down = planGateCoreRebalance({ heldCodes: ["A", "X"], targets: ["A", "B"], trendUp: false, slots: 3 });
  assert.deepEqual(down, { sell: ["X"], keep: ["A"], buy: [] });
});

test("isGateCoreRebalanceDue: 이번 달 교체 전이면 true", () => {
  assert.equal(isGateCoreRebalanceDue("2026-11-02", "2026-10"), true);
  assert.equal(isGateCoreRebalanceDue("2026-11-20", "2026-11"), false);
  assert.equal(isGateCoreRebalanceDue("2026-11-02", null), true);
});

test("simulateGateCore: 보유 칸은 종목 수익, 빈 칸은 CD금리", () => {
  const bars = new Map<string, Map<string, DailyBar>>([
    ["A", new Map([
      ["2026-10-01", { date: "2026-10-01", open: 100, close: 100, volume: 1 }],
      ["2026-11-02", { date: "2026-11-02", open: 110, close: 110, volume: 1 }],
    ])],
  ]);
  const r = simulateGateCore({
    rebalanceDates: ["2026-10-01", "2026-11-02"],
    targetsAt: () => ["A"],
    trendUpAt: () => true,
    barsByCode: bars,
    slots: 2,
    plan: planGateCoreRebalance,
  });
  // (10% + 한 달 CD ≈0.23%)/2 − 매수 비용 0.225%/2
  assert.ok(r.totalReturnPct > 4.9 && r.totalReturnPct < 5.1, String(r.totalReturnPct));
});

test("resolveActivationState: 봇에 구현된 gate-top20은 승인 즉시 켜지고 해제하면 꺼진다", () => {
  const s = resolveActivationState([
    { strategy: "gate-top20", action: "approve", at: "2026-11-27T00:00:00Z", by: "1", source: "telegram" },
  ]);
  assert.equal(s.active, "gate-top20");
  const off = resolveActivationState([
    { strategy: "gate-top20", action: "approve", at: "2026-11-27T00:00:00Z", by: "1", source: "telegram" },
    { strategy: "gate-top20", action: "deactivate", at: "2026-11-28T00:00:00Z", by: "1", source: "web" },
  ]);
  assert.equal(off.active, null);
});
