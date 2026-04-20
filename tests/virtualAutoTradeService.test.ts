import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStrategyBuyConstraint,
  deriveAdaptiveMinBuyScore,
  pickAutoTradeAddOnCandidates,
  pickAutoTradeCandidates,
  selectRunType,
} from "../src/services/virtualAutoTradeSelection";

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

test("applyStrategyBuyConstraint: HOLD_SAFE 기존 보유가 있으면 신규 매수 차단", () => {
  const result = applyStrategyBuyConstraint({
    selectedStrategy: "HOLD_SAFE",
    requestedSlots: 2,
    baseMinBuyScore: 70,
    activeCount: 1,
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