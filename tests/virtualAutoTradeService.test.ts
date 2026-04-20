import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStrategyBuyConstraint,
  deriveAdaptiveMinBuyScore,
  pickAutoTradeAddOnCandidates,
  pickAutoTradeCandidates,
  selectRunType,
} from "../src/services/virtualAutoTradeSelection";
import {
  classifyAutoTradeEntryProfile,
  buildPositionStrategyMemo,
  parsePositionStrategyState,
  planAutoTradeExit,
  resolvePositionTradeProfile,
} from "../src/services/virtualAutoTradePositionStrategy";

test("selectRunType: auto 모드는 KST 월요일에 monday buy를 선택한다", () => {
  const sundayUtc = new Date("2026-04-19T18:00:00.000Z");
  assert.equal(selectRunType("auto", sundayUtc), "MONDAY_BUY");
});

test("deriveAdaptiveMinBuyScore: 현재 상위 점수대에 맞춰 기준을 완화한다", () => {
  assert.equal(deriveAdaptiveMinBuyScore(70, 53), 50);
  assert.equal(deriveAdaptiveMinBuyScore(70, 40), 37);
  assert.equal(deriveAdaptiveMinBuyScore(70, 34), 35);
});

test("pickAutoTradeCandidates: BUY 신호가 없어도 상위 점수대 fallback 후보를 반환한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      { code: "A", close: 10000, score: 53, name: "Alpha", signal: "HOLD" },
      { code: "B", close: 9000, score: 51, name: "Beta", signal: "HOLD" },
      { code: "C", close: 8000, score: 47, name: "Gamma", signal: "SELL" },
    ],
    preferredMinBuyScore: 70,
    limit: 2,
    heldCodes: new Set<string>(),
  });

  assert.equal(result.selectionMode, "top-score-fallback");
  assert.equal(result.thresholdUsed, 50);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.code),
    ["A", "B"]
  );
});

test("applyStrategyBuyConstraint: HOLD_SAFE 무보유면 1종목만 최소 진입 허용", () => {
  const result = applyStrategyBuyConstraint({
    selectedStrategy: "HOLD_SAFE",
    requestedSlots: 3,
    baseMinBuyScore: 70,
    activeCount: 0,
  });

  assert.equal(result.buySlots, 1);
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "hold-safe-probe");
});

test("applyStrategyBuyConstraint: HOLD_SAFE 기존 보유 1종목이면 1종목 추가 진입을 허용", () => {
  const result = applyStrategyBuyConstraint({
    selectedStrategy: "HOLD_SAFE",
    requestedSlots: 2,
    baseMinBuyScore: 70,
    activeCount: 1,
  });

  assert.equal(result.buySlots, 1);
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "hold-safe-probe");
});

test("applyStrategyBuyConstraint: HOLD_SAFE 기존 보유 2종목이면 신규 매수를 차단", () => {
  const result = applyStrategyBuyConstraint({
    selectedStrategy: "HOLD_SAFE",
    requestedSlots: 2,
    baseMinBuyScore: 70,
    activeCount: 2,
  });

  assert.equal(result.buySlots, 0);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "strategy-blocked-buy");
});

test("pickAutoTradeAddOnCandidates: 보유 종목도 눌림 또는 강한 연속 신호면 추가매수 후보가 된다", () => {
  const result = pickAutoTradeAddOnCandidates({
    rows: [
      { code: "A", close: 10200, score: 76, name: "Alpha", signal: "BUY" },
      { code: "B", close: 15000, score: 80, name: "Beta", signal: "HOLD" },
    ],
    preferredMinBuyScore: 72,
    limit: 2,
    holdingsByCode: new Map([
      ["A", { code: "A", buyPrice: 10000 }],
      ["B", { code: "B", buyPrice: 12000 }],
    ]),
  });

  assert.equal(result.selectionMode, "held-add-on");
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.code),
    ["A"]
  );
});

test("pickAutoTradeAddOnCandidates: RSI 과열 구간은 추가매수에서 제외한다", () => {
  const result = pickAutoTradeAddOnCandidates({
    rows: [
      { code: "A", close: 10100, score: 79, name: "Alpha", signal: "BUY", rsi14: 74 },
    ],
    preferredMinBuyScore: 72,
    limit: 1,
    holdingsByCode: new Map([["A", { code: "A", buyPrice: 10000, allowAddOn: true }]]),
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.selectionMode, "none");
});

test("buildPositionStrategyMemo/parsePositionStrategyState: 포지션별 전략과 익절 상태를 memo에 저장한다", () => {
  const memo = buildPositionStrategyMemo({
    event: "entry",
    note: "autotrade-entry",
    profile: "SWING",
    takeProfitTranchesDone: 1,
  });

  const parsed = parsePositionStrategyState(memo, "DEFAULT");
  assert.equal(parsed.profile, "SWING");
  assert.equal(parsed.takeProfitTranchesDone, 1);
});

test("resolvePositionTradeProfile: REDUCE_TIGHT 포지션은 전량 익절 구조를 사용한다", () => {
  const profile = resolvePositionTradeProfile({
    accountStrategy: "REDUCE_TIGHT",
    baseTakeProfitPct: 8,
    baseStopLossPct: 4,
    sellSplitCount: 3,
  });

  assert.equal(profile.profile, "REDUCE_TIGHT");
  assert.equal(profile.takeProfitPct, 4);
  assert.equal(profile.stopLossPct, 2);
  assert.equal(profile.takeProfitSplitCount, 1);
  assert.equal(profile.allowAddOn, false);
});

test("classifyAutoTradeEntryProfile: 보수 전략의 강한 후보는 코어 또는 스윙으로 분류한다", () => {
  const profile = classifyAutoTradeEntryProfile({
    accountStrategy: "HOLD_SAFE",
    riskProfile: "safe",
    candidate: {
      score: 85,
      signal: "BUY",
      rsi14: 54,
      liquidity: 20_000_000_000,
    },
  });

  assert.equal(profile, "POSITION_CORE");
});

test("classifyAutoTradeEntryProfile: 공격 성향의 일반 후보는 단기 스윙으로 분류할 수 있다", () => {
  const profile = classifyAutoTradeEntryProfile({
    accountStrategy: "DEFAULT",
    riskProfile: "active",
    candidate: {
      score: 74,
      signal: "BUY",
      rsi14: 57,
      liquidity: 12_000_000_000,
    },
  });

  assert.equal(profile, "SHORT_SWING");
});

test("planAutoTradeExit: 분할 익절은 첫 신호에서 일부만 매도한다", () => {
  const plan = planAutoTradeExit({
    quantity: 5,
    pnlPct: 9,
    takeProfitPct: 8,
    stopLossPct: 4,
    takeProfitSplitCount: 3,
    takeProfitTranchesDone: 0,
  });

  assert.equal(plan.action, "TAKE_PROFIT");
  assert.equal(plan.isPartial, true);
  assert.equal(plan.quantityToSell, 2);
  assert.equal(plan.nextTakeProfitTranchesDone, 1);
});

test("planAutoTradeExit: 마지막 익절 tranche 는 잔량 전부 매도한다", () => {
  const plan = planAutoTradeExit({
    quantity: 3,
    pnlPct: 9,
    takeProfitPct: 8,
    stopLossPct: 4,
    takeProfitSplitCount: 2,
    takeProfitTranchesDone: 1,
  });

  assert.equal(plan.action, "TAKE_PROFIT");
  assert.equal(plan.isPartial, false);
  assert.equal(plan.quantityToSell, 3);
  assert.equal(plan.reason, "take-profit-final");
});