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
      total: 48,
      signal: "hold",
      stableTrust: 42,
      stableTurn: "none",
      stableAboveAvg: false,
      stableAccumulation: false,
    },
    ["trend", "accumulation", "entry"]
  );

  assert.equal(matched, true);
  assert.equal(blocked, false);
});

test("matchesScanFilters: 매집은 accumulation 플래그가 없어도 안정 구간이면 통과할 수 있다", () => {
  const relaxedMatch = matchesScanFilters(
    {
      total: 63,
      signal: "watch",
      stableTrust: 62,
      stableTurn: "none",
      stableAboveAvg: true,
      stableAccumulation: false,
    },
    ["accumulation"]
  );

  assert.equal(relaxedMatch, true);
});

test("matchesScanFilters: 세력 필터는 bull turn도 통과시킨다", () => {
  const matched = matchesScanFilters(
    {
      total: 54,
      signal: "hold",
      stableTrust: 48,
      stableTurn: "bull-weak",
      stableAboveAvg: false,
      stableAccumulation: false,
    },
    ["stable"]
  );

  assert.equal(matched, true);
});

test("matchesScanFilters: entry 필터는 최근 IN 흔적도 통과시킨다", () => {
  const matched = matchesScanFilters(
    {
      total: 59,
      signal: "hold",
      stableTrust: 49,
      stableTurn: "none",
      stableAboveAvg: true,
      stableAccumulation: false,
      recentInDays: 1,
    },
    ["entry"]
  );

  assert.equal(matched, true);
});

test("matchesScanFilters: accumulation 필터는 최근 매집 지속도 통과시킨다", () => {
  const matched = matchesScanFilters(
    {
      total: 54,
      signal: "hold",
      stableTrust: 50,
      stableTurn: "none",
      stableAboveAvg: false,
      stableAccumulation: false,
      recentAccumulationDays: 2,
    },
    ["accumulation"]
  );

  assert.equal(matched, true);
});

test("matchesScanFilters: 눌림목 A/B 단독으로는 진입 필터를 통과하지 않는다", () => {
  const matched = matchesScanFilters(
    {
      total: 0,
      signal: "",
      stableTrust: 0,
      stableTurn: "none",
      stableAboveAvg: false,
      stableAccumulation: false,
    },
    ["entry"],
    {
      entryGrade: "A",
      entryScore: 3,
      trendGrade: "B",
      distGrade: "A",
    }
  );

  assert.equal(matched, false);
});

test("matchesScanFilters: 매집 필터는 IN 신호와 눌림목 맥락에서도 통과할 수 있다", () => {
  const matched = matchesScanFilters(
    {
      total: 56,
      signal: "buy",
      stableTrust: 60,
      stableTurn: "none",
      stableAboveAvg: true,
      stableAccumulation: false,
      recentInDays: 1,
      recentAccumulationDays: 0,
    },
    ["accumulation"],
    {
      entryGrade: "B",
      entryScore: 3,
      trendGrade: "B",
      distGrade: "A",
    }
  );

  assert.equal(matched, true);
});

test("formatScanFilterLabels: 사용자 노출 라벨을 반환한다", () => {
  assert.deepEqual(formatScanFilterLabels(["stable", "entry"]), ["세력선 우위", "IN 타이밍"]);
});