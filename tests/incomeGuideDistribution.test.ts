import test from "node:test";
import assert from "node:assert/strict";
import { estimateDistribution, BUCKET_YIELD_PCT, type AssetBucket } from "../src/lib/incomeGuide";

test("분배금 추정: 바구니별 분배율 가정에서 세금(15.4%)을 뺀 월 금액", () => {
  const byBucket = new Map<AssetBucket, number>([["covered_call", 10_000_000], ["dividend", 20_000_000]]);
  const d = estimateDistribution(byBucket);
  const gross = 10_000_000 * (BUCKET_YIELD_PCT.covered_call / 100) + 20_000_000 * (BUCKET_YIELD_PCT.dividend / 100);
  assert.equal(d.annualGross, Math.round(gross));
  assert.equal(d.monthlyNet, Math.round((gross * (1 - 0.154)) / 12));
  assert.equal(d.isEstimate, true);
});

test("분배금 추정: 보유가 없으면 0", () => {
  assert.equal(estimateDistribution(new Map()).monthlyNet, 0);
});
