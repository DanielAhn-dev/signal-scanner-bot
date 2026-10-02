import test from "node:test";
import assert from "node:assert/strict";
import { buildFreshnessLabel, isBusinessStale } from "../src/utils/dataFreshness";

test("dataFreshness: 잘못된 날짜는 stale 처리", () => {
  assert.equal(isBusinessStale("not-a-date", 1), true);
  assert.equal(buildFreshnessLabel("not-a-date", 1), "기준일 확인 불가");
});

test("dataFreshness: 오늘 기준 날짜는 stale 아님", () => {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const kst = new Date(utcMs + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const today = `${y}-${m}-${d}`;

  assert.equal(isBusinessStale(today, 1), false);
});

import { evaluateCoverage, buildFreshnessAlertMessage } from "../src/services/dataFreshnessMonitorService";

test("evaluateCoverage: 직전 거래일의 85% 미만이면 부분 적재", () => {
  assert.equal(evaluateCoverage(100, 1000).isLowCoverage, true);
  assert.equal(evaluateCoverage(900, 1000).isLowCoverage, false);
  assert.equal(evaluateCoverage(231, 230).isLowCoverage, false);
});

test("evaluateCoverage: 기준 표본이 작거나 조회 실패면 판정하지 않는다", () => {
  assert.equal(evaluateCoverage(1, 10).isLowCoverage, false);
  assert.equal(evaluateCoverage(null, 1000).isLowCoverage, false);
});

test("buildFreshnessAlertMessage: 부분 적재 행 수를 함께 알린다", () => {
  const msg = buildFreshnessAlertMessage([
    { key: "ohlcv", label: "OHLCV", latestDate: "2026-10-01", staleBizDays: 0, isStale: true, maxBizDays: 1, isLowCoverage: true, latestCount: 3, prevCount: 230 },
  ]);
  assert.ok(msg?.includes("3행 / 직전 거래일 230행"));
});
