import test from "node:test";
import assert from "node:assert/strict";
import {
  pickAutoTradeAddOnCandidates,
  type HeldPositionForAddOn,
  type RankedCandidate,
} from "../src/services/virtualAutoTradeSelection";

function row(overrides: Partial<RankedCandidate>): RankedCandidate {
  return {
    code: "000000",
    close: 10100,
    score: 90,
    name: "테스트종목",
    rsi14: 55,
    liquidity: 0,
    ...overrides,
  };
}

test("pickAutoTradeAddOnCandidates: buyPrice<=0인 보유 포지션은 추가매수 대상에서 제외", () => {
  const holdingsByCode = new Map<string, HeldPositionForAddOn>([
    ["000001", { code: "000001", buyPrice: 0 }],
  ]);

  const result = pickAutoTradeAddOnCandidates({
    rows: [row({ code: "000001" })],
    preferredMinBuyScore: 70,
    limit: 10,
    holdingsByCode,
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.filteringMetrics.rejectedByReason.invalidBuyPrice, 1);
});

test("pickAutoTradeAddOnCandidates: 정상 buyPrice에 밴드 이내 종목은 정상 선정", () => {
  const holdingsByCode = new Map<string, HeldPositionForAddOn>([
    ["000002", { code: "000002", buyPrice: 10000 }],
  ]);

  const result = pickAutoTradeAddOnCandidates({
    // close=10100 vs buyPrice=10000 → pullback +1% (밴드 -6~+3% 이내)
    rows: [row({ code: "000002", close: 10100 })],
    preferredMinBuyScore: 70,
    limit: 10,
    holdingsByCode,
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.code, "000002");
  assert.equal(result.filteringMetrics.rejectedByReason.invalidBuyPrice, 0);
});
