import assert from "node:assert/strict";
import {
  findLatestActualAnnualValue,
  growthPctFromRow,
  takeActualAnnualNumbers,
} from "../src/services/fundamentalParser";
import {
  formatEokAmount,
  formatFundamentalInline,
} from "../src/bot/messages/fundamental";

function approxEqual(actual: number | undefined, expected: number, tolerance = 0.001) {
  assert.notEqual(actual, undefined, "expected a numeric value");
  assert.ok(Math.abs((actual as number) - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

const naverSalesRow = [
  "96,706",
  "107,377",
  "120,350",
  "134,006",
  "28,856",
  "27,868",
  "29,151",
  "31,381",
];

const debtRatioRow = [
  "47.45",
  "41.36",
  "41.90",
  "",
  "41.36",
  "40.26",
  "40.86",
  "41.59",
];

assert.deepEqual(takeActualAnnualNumbers(naverSalesRow), [96706, 107377, 120350]);
assert.equal(findLatestActualAnnualValue(naverSalesRow), 120350);
approxEqual(growthPctFromRow(naverSalesRow), 12.08173072445682, 0.000001);

assert.equal(findLatestActualAnnualValue(debtRatioRow), 41.9);

assert.equal(formatEokAmount(120350), "12.04조원 (120,350억원)");
assert.equal(formatEokAmount(7320), "7,320억원");

assert.equal(
  formatFundamentalInline(
    { qualityScore: 77, per: 17.45, pbr: 1.17, roe: 7.36, debtRatio: 41.9 },
    { includeDebtRatio: true }
  ),
  "재무건강도(내부) 77점 · PER 17.45 · PBR 1.17 · ROE 7.36% · 부채 41.90%"
);

console.log("fundamental parser verification passed");