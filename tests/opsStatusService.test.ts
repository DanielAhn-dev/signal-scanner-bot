import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateAutoTradeSkipReasonStats,
  formatAutoTradeSkipReasonStats,
} from "../src/services/opsStatusService";

test("aggregateAutoTradeSkipReasonStats: 여러 실행 요약의 스킵 사유를 합산한다", () => {
  const stats = aggregateAutoTradeSkipReasonStats([
    {
      skipReasonStats: [
        { code: "duplicate_window", label: "동일 실행창 중복 스킵", count: 2 },
        { code: "insufficient_cash", label: "현금 부족", count: 1 },
      ],
    },
    {
      skipReasonStats: [
        { code: "duplicate_window", label: "동일 실행창 중복 스킵", count: 1 },
        { code: "cash_reserve_floor", label: "현금 하한 유지", count: 3 },
      ],
    },
  ]);

  assert.deepEqual(stats, [
    { code: "cash_reserve_floor", label: "현금 하한 유지", count: 3 },
    { code: "duplicate_window", label: "동일 실행창 중복 스킵", count: 3 },
    { code: "insufficient_cash", label: "현금 부족", count: 1 },
  ]);
});

test("formatAutoTradeSkipReasonStats: 상위 사유를 한 줄 텍스트로 포맷한다", () => {
  const text = formatAutoTradeSkipReasonStats([
    { code: "duplicate_window", label: "동일 실행창 중복 스킵", count: 3 },
    { code: "cash_reserve_floor", label: "현금 하한 유지", count: 2 },
  ]);

  assert.equal(text, "동일 실행창 중복 스킵 3건 · 현금 하한 유지 2건");
});

test("formatAutoTradeSkipReasonStats: 집계가 없으면 없음으로 표시한다", () => {
  assert.equal(formatAutoTradeSkipReasonStats([]), "없음");
});
