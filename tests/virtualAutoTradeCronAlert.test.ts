import test from "node:test";
import assert from "node:assert/strict";
import { buildAutoTradeCronAlertMessage } from "../src/services/virtualAutoTradeCronAlert";
import type { AutoTradeRunSummary } from "../src/services/virtualAutoTradeService";

function makeSummary(overrides: Partial<AutoTradeRunSummary> = {}): AutoTradeRunSummary {
  return {
    runKey: "2026-04-24-0900",
    totalUsers: 10,
    processedUsers: 10,
    buyCount: 1,
    sellCount: 0,
    skippedCount: 2,
    errorCount: 0,
    skipReasonStats: [],
    ...overrides,
  };
}

test("buildAutoTradeCronAlertMessage: 이상 징후가 없으면 null", () => {
  const message = buildAutoTradeCronAlertMessage(makeSummary());
  assert.equal(message, null);
});

test("buildAutoTradeCronAlertMessage: duplicate_window 임계치 이상이면 운영 알림을 만든다", () => {
  const message = buildAutoTradeCronAlertMessage(
    makeSummary({
      skipReasonStats: [{ code: "duplicate_window", label: "동일 실행창 중복 스킵", count: 3 }],
    })
  );

  assert.ok(message);
  assert.match(message, /자동사이클 운영 알림/);
  assert.match(message, /동일 실행창 중복 스킵 3건/);
  assert.match(message, /수동 실행\/중복 호출 여부를 확인하세요/);
});

test("buildAutoTradeCronAlertMessage: 장외 실행이나 오류도 즉시 알린다", () => {
  const outOfSessionMessage = buildAutoTradeCronAlertMessage(
    makeSummary({
      skipReasonStats: [{ code: "out_of_session", label: "장중 시간 외 스킵", count: 1 }],
    })
  );
  const errorMessage = buildAutoTradeCronAlertMessage(
    makeSummary({
      errorCount: 1,
      skipReasonStats: [{ code: "fetch_failed", label: "데이터 조회 실패", count: 1 }],
    })
  );

  assert.ok(outOfSessionMessage);
  assert.match(outOfSessionMessage, /장중 cron 시각 또는 intradayOnly 호출 경로를 확인하세요/);
  assert.ok(errorMessage);
  assert.match(errorMessage, /오류 로그와 virtual_autotrade_runs 상세를 우선 확인하세요/);
});
