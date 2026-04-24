import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoTradeSkipReasonStats,
  resolveAutoTradeSkipReasonCode,
} from "../src/services/virtualAutoTradeObservability";

test("resolveAutoTradeSkipReasonCode: 대표 스킵 메모를 코드로 변환한다", () => {
  assert.equal(resolveAutoTradeSkipReasonCode("신규 매수 중단: 일손실 한도 도달 ( -50,000원 / 기준 -40,000원 )"), "daily_loss_limit");
  assert.equal(resolveAutoTradeSkipReasonCode("신규 매수 불가: 투자 가능 현금 0원"), "no_deployable_cash");
  assert.equal(resolveAutoTradeSkipReasonCode("[자동사이클] 동일 실행창(2026-04-24T10:10) 이미 처리됨"), "duplicate_window");
});

test("buildAutoTradeSkipReasonStats: 액션 메모에서 스킵 사유를 집계한다", () => {
  const stats = buildAutoTradeSkipReasonStats({
    actions: [
      {
        skipped: 1,
        notes: ["신규 매수 보류: 현금 하한 유지 구간"],
      },
      {
        skipped: 1,
        notes: ["[자동사이클] 동일 실행창(2026-04-24T10:10) 이미 처리됨"],
      },
      {
        skipped: 1,
        notes: ["현금 부족으로 매수 스킵 2건 (회당 예산/종목가격 조합으로 최소주문 500,000원 미달 포함)"],
      },
    ],
  });

  assert.deepEqual(stats, [
    { code: "cash_reserve_floor", label: "현금 하한 유지", count: 1 },
    { code: "duplicate_window", label: "동일 실행창 중복 스킵", count: 1 },
    { code: "insufficient_cash", label: "현금 부족", count: 1 },
  ]);
});

test("buildAutoTradeSkipReasonStats: 장외 스킵 같은 추가 코드도 집계한다", () => {
  const stats = buildAutoTradeSkipReasonStats({
    actions: [],
    extraReasonCodes: ["out_of_session"],
  });

  assert.deepEqual(stats, [
    { code: "out_of_session", label: "장중 외 시간 스킵", count: 1 },
  ]);
});