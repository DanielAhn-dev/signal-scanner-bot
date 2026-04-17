import assert from "node:assert/strict";
import {
  analyzeGrowthRow,
  findLatestActualAnnualValue,
  growthPctFromRow,
  takeActualAnnualNumbers,
} from "../src/services/fundamentalParser";
import {
  formatEokAmount,
  formatFundamentalInline,
  formatPer,
} from "../src/bot/messages/fundamental";
import { evaluateFundamentalQuality } from "../src/services/fundamentalService";
import { resolveFundamentalProfile } from "../src/services/fundamentalProfile";

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
assert.equal(formatPer(-23.85), "적자(-23.85)");

assert.equal(
  formatFundamentalInline(
    { qualityScore: 77, per: 17.45, pbr: 1.17, roe: 7.36, debtRatio: 41.9 },
    { includeDebtRatio: true }
  ),
  "재무건강도(내부) 77점 · PER 17.45 · PBR 1.17 · ROE 7.36% · 부채 41.90%"
);

assert.equal(resolveFundamentalProfile({ sectorName: "인터넷서비스" }).key, "growth");
assert.equal(resolveFundamentalProfile({ sectorName: "반도체와반도체장비" }).key, "semiconductor");
assert.equal(resolveFundamentalProfile({ sectorName: "은행" }).key, "assetHeavy");
assert.equal(resolveFundamentalProfile({ sectorCategory: "Health Care" }).key, "growth");

const lowBaseGrowth = analyzeGrowthRow(["5530", "140", "5909", "0"], {
  lowBaseFloor: 500,
});
assert.equal(lowBaseGrowth.lowBase, true);
assert.equal(lowBaseGrowth.turnaround, false);

const bankLikeQuality = evaluateFundamentalQuality({
  sectorName: "은행",
  per: 8.5,
  pbr: 0.92,
  roe: 9.2,
  debtRatio: 30,
  salesGrowthPct: 4,
  opIncomeGrowthPct: 7,
  netIncomeGrowthPct: 6,
});

assert.ok(bankLikeQuality.score >= 70, `expected bank-like quality score to be favorable, got ${bankLikeQuality.score}`);

const deficitQuality = evaluateFundamentalQuality({
  per: -23.85,
  pbr: 2.44,
  roe: 4.59,
  debtRatio: 82.49,
  salesGrowthPct: 2.98,
  opIncomeGrowthPct: 47.78,
  opIncomeGrowthLowBase: true,
  netIncomeGrowthPct: 419.95,
  netIncomeGrowthLowBase: true,
});

assert.match(deficitQuality.commentary, /적자 구간으로 PER 해석 제한/);
assert.match(deficitQuality.commentary, /낮은 기저 영향 가능성/);
assert.ok(deficitQuality.score < 50, `expected deficit quality score to stay conservative, got ${deficitQuality.score}`);

console.log("fundamental parser verification passed");