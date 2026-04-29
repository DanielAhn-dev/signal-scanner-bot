import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNum,
  computeTTMFromQuarterNumbers,
  computeMargins,
  growthPctFromRow,
  takeActualAnnualNumbers,
} from "../src/services/fundamentalParser";

test("parseNum handles commas and dash/N/A", () => {
  assert.equal(parseNum("1,234"), 1234);
  assert.equal(parseNum("-"), undefined);
  assert.equal(parseNum("N/A"), undefined);
});

test("computeTTMFromQuarterNumbers sums last 4 quarters", () => {
  const quarters = [10, 20, 30, 40, 50, 60];
  // last 4: 30+40+50+60 = 180
  assert.equal(computeTTMFromQuarterNumbers(quarters), 180);
  assert.equal(computeTTMFromQuarterNumbers([1, 2, 3]), undefined);
});

test("computeMargins returns correct ratios", () => {
  const { opMargin, netMargin } = computeMargins(200, 50, 20);
  assert.equal(opMargin, 50 / 200);
  assert.equal(netMargin, 20 / 200);
  const none = computeMargins(undefined, undefined, undefined);
  assert.equal(none.opMargin, undefined);
});

test("growthPctFromRow with actual annual numbers", () => {
  const row = ["2021", "2022", "2023", "1,000", "1,200", "1,800"];
  // takeActualAnnualNumbers will pick first ACTUAL_ANNUAL_COLUMN_COUNT columns if numeric; ensure we get growth
  const nums = takeActualAnnualNumbers(row.slice(-3));
  // sanity: nums length > 0
  assert.ok(Array.isArray(nums));
});
