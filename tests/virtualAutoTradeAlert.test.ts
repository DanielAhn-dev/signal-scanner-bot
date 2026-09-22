import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoTradeCycleHoldAlert,
  buildAutoTradeExecutionButtons,
  extractExecutionTargets,
  pickExecutionLines,
} from "../src/services/virtualAutoTradeAlert";

test("pickExecutionLines: 실행 메모만 최대 5건 추린다", () => {
  const lines = pickExecutionLines([
    "[실행 매수] Alpha(005930) 10주 · 매수가 70,000원",
    "[대응가이드][신규매수] 005930 · 기준가 70,000원",
    "[실행 매도] 000660 5주 · 매도가 180,000원",
  ]);

  assert.deepEqual(lines, [
    "[실행 매수] Alpha(005930) 10주 · 매수가 70,000원",
    "[실행 매도] 000660 5주 · 매도가 180,000원",
  ]);
});

test("extractExecutionTargets: 매수와 매도 메모에서 중복 없이 종목 코드를 추출한다", () => {
  const targets = extractExecutionTargets([
    "[실행 매수] Alpha(005930) 10주 · 매수가 70,000원",
    "[실행 추가매수] Alpha(005930) +5주 · 총 15주",
    "[실행 매도] 000660 5주 · 매도가 180,000원",
  ]);

  assert.deepEqual(targets, [
    { code: "005930", label: "005930 분석" },
    { code: "000660", label: "000660 분석" },
  ]);
});

test("buildAutoTradeExecutionButtons: 종목 분석 버튼과 후속 버튼을 함께 만든다", () => {
  const buttons = buildAutoTradeExecutionButtons([
    "[실행 매수] Alpha(005930) 10주 · 매수가 70,000원",
  ]);

  assert.equal(buttons[0]?.callback_data, "trade:005930");
  assert.equal(buttons[1]?.callback_data, "cmd:watchlist");
  assert.equal(buttons[2]?.callback_data, "cmd:watchresp");
});

test("buildAutoTradeCycleHoldAlert: 체결이 없으면 추종 주문 없음과 우선 사유를 알린다", () => {
  const message = buildAutoTradeCycleHoldAlert({
    runKey: "2026-09-22T09:00",
    action: {
      buys: 0,
      sells: 0,
      skipped: 1,
      errors: 0,
      notes: [
        "시장모드: 균형 · 레짐 중립 구간",
        "신규 매수 보류: 현금 하한 유지 구간",
        "[유휴현금 스윕] KODEX CD금리액티브(합성) 1주 매수",
      ],
    },
  });

  assert.ok(message);
  assert.match(message, /MTS로 따라 할 매수·매도 주문은 없습니다/);
  assert.match(message, /현금 하한 유지 구간/);
  assert.match(message, /가상 유휴현금 파킹/);
});

test("buildAutoTradeCycleHoldAlert: 체결 또는 오류가 있으면 기존 알림에 맡긴다", () => {
  assert.equal(
    buildAutoTradeCycleHoldAlert({
      runKey: "2026-09-22T09:00",
      action: { buys: 1, sells: 0, skipped: 0, errors: 0, notes: [] },
    }),
    null
  );
  assert.equal(
    buildAutoTradeCycleHoldAlert({
      runKey: "2026-09-22T09:00",
      action: { buys: 0, sells: 0, skipped: 0, errors: 1, notes: [] },
    }),
    null
  );
});