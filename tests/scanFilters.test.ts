import test from "node:test";
import assert from "node:assert/strict";
import {
  formatScanFilterLabels,
  matchesScanFilters,
  parseScanInput,
} from "../src/bot/commands/scanFilters";

test("parseScanInput: 섹터와 필터 토큰을 분리한다", () => {
  const parsed = parseScanInput("반도체 추세 매집 in");

  assert.equal(parsed.query, "반도체");
  assert.deepEqual(parsed.filters, ["trend", "accumulation", "entry"]);
});

test("matchesScanFilters: 추세·매집·진입 조합을 모두 만족해야 한다", () => {
  const matched = matchesScanFilters(
    {
      total: 72,
      signal: "buy",
      stableTrust: 78,
      stableTurn: "bull-strong",
      stableAboveAvg: true,
      stableAccumulation: true,
    },
    ["trend", "accumulation", "entry"]
  );

  const blocked = matchesScanFilters(
    {
      total: 72,
      signal: "buy",
      stableTrust: 78,
      stableTurn: "bull-strong",
      stableAboveAvg: true,
      stableAccumulation: false,
    },
    ["trend", "accumulation", "entry"]
  );

  assert.equal(matched, true);
  assert.equal(blocked, false);
});

test("formatScanFilterLabels: 사용자 노출 라벨을 반환한다", () => {
  assert.deepEqual(formatScanFilterLabels(["stable", "entry"]), ["세력선 우위", "IN 타이밍"]);
});