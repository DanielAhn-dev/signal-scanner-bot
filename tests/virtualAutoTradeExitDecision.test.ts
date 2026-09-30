import test from "node:test";
import assert from "node:assert/strict";
import { decideHoldingExit, type HoldingExitInput } from "../src/services/virtualAutoTradeExitDecision";

const NOW = new Date("2026-09-30T03:00:00Z");

function input(overrides: Partial<HoldingExitInput> = {}): HoldingExitInput {
  return {
    holding: { code: "005930", buy_date: "2026-09-20", planned_review_at: null },
    qty: 10,
    buyPrice: 100_000,
    close: 101_000,
    tradeProfile: { profile: "SWING", takeProfitPct: 8, stopLossPct: 4, takeProfitSplitCount: 2, expectedHorizonDays: 10 },
    strategyState: { takeProfitTranchesDone: 0, peakPrice: null },
    scoreRow: undefined,
    market: "KOSPI",
    marketPolicy: { mode: "balanced" },
    priceHistory: [],
    rebalanceTrustThreshold: 60,
    // 보유분 101만원이 전체의 10% — 비중 초과 아님
    totalPortfolioValue: 10_100_000,
    sectorId: undefined,
    sectorGrade: undefined,
    isSectorLeader: false,
    now: NOW,
    ...overrides,
  };
}

test("decideHoldingExit: 손익이 기준 범위 안이면 보유한다", () => {
  const decision = decideHoldingExit(input());
  assert.equal(decision.finalExitPlan.action, "HOLD");
  assert.equal(decision.exitReasonLabel, "");
  assert.equal(decision.stopLossContext, null);
});

test("decideHoldingExit: 경직 손절선(-10%)을 넘으면 전량 손절한다", () => {
  const decision = decideHoldingExit(input({ close: 88_000 }));
  assert.equal(decision.finalExitPlan.action, "STOP_LOSS");
  assert.equal(decision.finalExitPlan.quantityToSell, 10);
  assert.equal(decision.stopLossContext, "hard-stop");
});

test("decideHoldingExit: 손절 기준(4%)보다 더 빠지면 경직 손절선 전이라도 손절한다", () => {
  const decision = decideHoldingExit(input({ close: 94_000 }));
  assert.equal(decision.finalExitPlan.action, "STOP_LOSS");
  assert.equal(decision.stopLossContext, "hard-stop");
});

test("decideHoldingExit: 고점 +20%에서 잠금선(+11%) 아래로 밀리면 전량 익절한다", () => {
  const decision = decideHoldingExit(
    input({ close: 105_000, strategyState: { takeProfitTranchesDone: 0, peakPrice: 120_000 } })
  );
  assert.equal(decision.finalExitPlan.action, "TAKE_PROFIT");
  assert.equal(decision.finalExitPlan.quantityToSell, 10);
  assert.match(decision.exitReasonLabel, /수익잠금 익절/);
  assert.equal(decision.updatedPeakPrice, 120_000);
});

test("decideHoldingExit: 보유 중 최고가는 오늘 가격이 더 높을 때만 올라간다", () => {
  const decision = decideHoldingExit(input({ close: 103_000, strategyState: { takeProfitTranchesDone: 0, peakPrice: 102_000 } }));
  assert.equal(decision.prevPeak, 102_000);
  assert.equal(decision.updatedPeakPrice, 103_000);
});

test("decideHoldingExit: 한 종목이 포트폴리오의 25%를 넘으면 비중 조정 매도한다", () => {
  const decision = decideHoldingExit(input({ totalPortfolioValue: 2_020_000 }));
  assert.equal(decision.finalExitPlan.action, "OVERWEIGHT_REDUCTION");
  assert.match(decision.exitReasonLabel, /비중조정/);
});

test("decideHoldingExit: 섹터가 C등급으로 떨어지면 리더가 아닌 종목은 정리한다", () => {
  const decision = decideHoldingExit(input({ sectorId: "semis", sectorGrade: "C" }));
  assert.equal(decision.finalExitPlan.action, "SECTOR_ROTATION");
  assert.equal(decideHoldingExit(input({ sectorId: "semis", sectorGrade: "C", isSectorLeader: true })).finalExitPlan.action, "HOLD");
});

const reviewDue = { code: "005930", buy_date: "2026-09-01", planned_review_at: "2026-09-29T00:00:00Z" };

test("decideHoldingExit: 예정 검토일이 지났는데 BUY 신호와 점수가 살아 있으면 검토일을 연장한다", () => {
  const decision = decideHoldingExit(
    input({ holding: reviewDue, scoreRow: { total_score: 70, signal: "BUY", factors: null } })
  );
  assert.equal(decision.finalExitPlan.action, "HOLD");
  assert.ok(decision.plannedReviewExtensionAt);
});

test("decideHoldingExit: 예정 검토일이 지났고 점수가 낮으면 BUY 신호여도 정리한다 (예전엔 점수를 못 읽어 연장됐다)", () => {
  const decision = decideHoldingExit(
    input({ holding: reviewDue, scoreRow: { total_score: 40, signal: "BUY", factors: null } })
  );
  assert.equal(decision.finalExitPlan.action, "TAKE_PROFIT");
  assert.match(decision.exitReasonLabel, /예정검토일 도달/);
});

test("decideHoldingExit: 예정 검토일이 지나 손실로 정리하면 손절 맥락이 planned-review-miss다", () => {
  const decision = decideHoldingExit(
    input({ holding: reviewDue, close: 99_000, scoreRow: { total_score: 40, signal: "HOLD", factors: null } })
  );
  assert.equal(decision.finalExitPlan.action, "STOP_LOSS");
  assert.equal(decision.stopLossContext, "planned-review-miss");
});
