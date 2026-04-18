import test from "node:test";
import assert from "node:assert/strict";
import type { InvestmentPlan } from "../src/lib/investPlan";
import { resolveWatchDecision } from "../src/lib/watchlistSignals";

const basePlan: InvestmentPlan = {
  status: "buy-now",
  statusLabel: "분할 진입 가능",
  marketTone: "neutral",
  entryLow: 9900,
  entryHigh: 10100,
  stopPrice: 9500,
  target1: 10800,
  target2: 11200,
  stopPct: 0.05,
  target1Pct: 0.08,
  target2Pct: 0.12,
  holdDays: [7, 18],
  riskReward: 1.6,
  conviction: 68,
  rationale: [],
  warnings: [],
  summary: "테스트 플랜",
  sizeFactor: 1.0,
};

test("resolveWatchDecision: STOP_LOSS 신호 + 트리거 없음이면 HOLD 억제", () => {
  const decision = resolveWatchDecision({
    close: 9400,
    buyPrice: 10000,
    plan: basePlan,
    microSignal: {
      valueRatio: 1.2,
      valueZ: 0.3,
      valueAnomaly: false,
      flowShift: false,
      foreign5d: 0,
      institution5d: 0,
      triggerReasons: [],
    },
  });

  assert.equal(decision.action, "HOLD");
  assert.equal(decision.executionGuardPassed, false);
  assert.equal(decision.blockedStopLoss, true);
});

test("resolveWatchDecision: STOP_LOSS 신호 + 트리거 충족이면 실행", () => {
  const decision = resolveWatchDecision({
    close: 9400,
    buyPrice: 10000,
    plan: basePlan,
    microSignal: {
      valueRatio: 3.4,
      valueZ: 2.6,
      valueAnomaly: true,
      flowShift: false,
      foreign5d: -1_000_000_000,
      institution5d: -500_000_000,
      triggerReasons: ["거래대금 급증(3.4배)"],
    },
  });

  assert.equal(decision.action, "STOP_LOSS");
  assert.equal(decision.executionGuardPassed, true);
});

test("resolveWatchDecision: 목표가 도달 + 트리거 충족이면 TAKE_PROFIT", () => {
  const decision = resolveWatchDecision({
    close: 10900,
    buyPrice: 10000,
    plan: basePlan,
    microSignal: {
      valueRatio: 2.1,
      valueZ: 2.2,
      valueAnomaly: true,
      flowShift: true,
      foreign5d: 2_000_000_000,
      institution5d: 1_500_000_000,
      triggerReasons: ["거래대금 급증(2.1배)", "외국인·기관 수급 유입 강화"],
    },
  });

  assert.equal(decision.action, "TAKE_PROFIT");
  assert.equal(decision.executionGuardPassed, true);
});
