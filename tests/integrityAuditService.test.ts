import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcileChatLedger,
  buildIntegrityReportMessage,
  countIntegrityIssues,
} from "../src/services/integrityAuditService";

const CHAT_ID = 12345;

test("reconcile: 매수/매도 원장이 현금·수량과 일치하면 이상 없음", () => {
  const result = reconcileChatLedger({
    chatId: CHAT_ID,
    seedCapital: 20_000_000,
    // 매수 3M − 매도 1.5M → 현금 = 20M − 3M + 1.5M = 18.5M
    virtualCash: 18_500_000,
    trades: [
      { code: "005930", side: "BUY", quantity: 40, net_amount: 3_000_000 },
      { code: "005930", side: "SELL", quantity: 20, net_amount: 1_500_000 },
    ],
    positions: [{ code: "005930", quantity: 20, status: "holding" }],
  });

  assert.equal(result.cashStatus, "ok");
  assert.equal(result.issues.length, 0);
  assert.equal(result.holdingCount, 1);
});

test("reconcile: 현금이 허용오차보다 크게 어긋나면 cash-mismatch", () => {
  const result = reconcileChatLedger({
    chatId: CHAT_ID,
    seedCapital: 20_000_000,
    virtualCash: 18_000_000, // 기대 18.5M 대비 -500k
    trades: [
      { code: "005930", side: "BUY", quantity: 40, net_amount: 3_000_000 },
      { code: "005930", side: "SELL", quantity: 20, net_amount: 1_500_000 },
    ],
    positions: [{ code: "005930", quantity: 20, status: "holding" }],
  });

  assert.equal(result.cashStatus, "mismatch");
  assert.equal(result.cashDiff, -500_000);
  assert.equal(result.issues[0]?.type, "cash-mismatch");
});

test("reconcile: 허용오차(시드의 0.1%, 최소 1천원) 이내면 정상", () => {
  const result = reconcileChatLedger({
    chatId: CHAT_ID,
    seedCapital: 20_000_000,
    virtualCash: 18_485_000, // 기대 18.5M 대비 -15,000원 (< 20,000원 허용)
    trades: [
      { code: "005930", side: "BUY", quantity: 40, net_amount: 3_000_000 },
      { code: "005930", side: "SELL", quantity: 20, net_amount: 1_500_000 },
    ],
    positions: [{ code: "005930", quantity: 20, status: "holding" }],
  });

  assert.equal(result.cashTolerance, 20_000);
  assert.equal(result.cashStatus, "ok");
});

test("reconcile: 거래누적 수량과 보유 수량이 다르면 quantity-mismatch", () => {
  const result = reconcileChatLedger({
    chatId: CHAT_ID,
    seedCapital: 20_000_000,
    virtualCash: 17_000_000,
    trades: [{ code: "005930", side: "BUY", quantity: 40, net_amount: 3_000_000 }],
    positions: [{ code: "005930", quantity: 30, status: "holding" }],
  });

  const qtyIssue = result.issues.find((issue) => issue.type === "quantity-mismatch");
  assert.ok(qtyIssue);
  assert.equal(qtyIssue.code, "005930");
});

test("reconcile: 청산 종목(closed)은 거래누적 0과 비교한다", () => {
  const result = reconcileChatLedger({
    chatId: CHAT_ID,
    seedCapital: 20_000_000,
    virtualCash: 20_500_000,
    trades: [
      { code: "005930", side: "BUY", quantity: 40, net_amount: 3_000_000 },
      { code: "005930", side: "SELL", quantity: 40, net_amount: 3_500_000 },
    ],
    positions: [{ code: "005930", quantity: 40, status: "closed" }],
  });

  // closed 포지션은 보유 0으로 취급 → 거래누적 0과 일치
  assert.equal(result.issues.length, 0);
  assert.equal(result.holdingCount, 0);
});

test("reconcile: 매도 누적이 매수를 초과하면 oversell", () => {
  const result = reconcileChatLedger({
    chatId: CHAT_ID,
    seedCapital: 20_000_000,
    virtualCash: 20_500_000, // 원장상 현금은 일치 (20M − 0.8M + 1.3M)
    trades: [
      { code: "005930", side: "BUY", quantity: 10, net_amount: 800_000 },
      { code: "005930", side: "SELL", quantity: 15, net_amount: 1_300_000 },
    ],
    positions: [],
  });

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.type, "oversell");
});

test("reconcile: ADJUST 이력이 있으면 현금은 추정치, 해당 종목 수량 검산은 제외", () => {
  const result = reconcileChatLedger({
    chatId: CHAT_ID,
    seedCapital: 20_000_000,
    virtualCash: 10_000_000, // 원장과 크게 어긋나지만 수동조정 이력 있음
    trades: [
      { code: "005930", side: "BUY", quantity: 40, net_amount: 3_000_000 },
      { code: "005930", side: "ADJUST", quantity: 5, net_amount: 0 },
    ],
    positions: [{ code: "005930", quantity: 45, status: "holding" }],
  });

  assert.equal(result.cashStatus, "estimated");
  assert.equal(result.adjustCount, 1);
  assert.equal(result.issues.length, 0);
});

test("report: 이상이 없으면 ✅ 한 줄 요약", () => {
  const healthy = reconcileChatLedger({
    chatId: CHAT_ID,
    seedCapital: 20_000_000,
    virtualCash: 20_000_000,
    trades: [],
    positions: [],
  });

  const message = buildIntegrityReportMessage({
    ymd: "2026-06-12",
    results: [healthy],
    staleHoldingCodes: [],
    freshnessDigest: "데이터 신선도 ✅ 전체 정상 (5개 테이블)",
  });

  assert.match(message, /✅ 원장 정상/);
  assert.match(message, /데이터 신선도 ✅/);
  assert.equal(countIntegrityIssues({ results: [healthy], staleHoldingCodes: [] }), 0);
});

test("report: 이상이 있으면 ❌와 상세 라인, 시세 누락 경고 포함", () => {
  const broken = reconcileChatLedger({
    chatId: CHAT_ID,
    seedCapital: 20_000_000,
    virtualCash: 15_000_000,
    trades: [{ code: "005930", side: "BUY", quantity: 40, net_amount: 3_000_000 }],
    positions: [{ code: "005930", quantity: 30, status: "holding" }],
  });

  const message = buildIntegrityReportMessage({
    ymd: "2026-06-12",
    results: [broken],
    staleHoldingCodes: ["123456"],
  });

  assert.match(message, /❌ 이상 \d+건/);
  assert.match(message, /005930/);
  assert.match(message, /시세 누락 보유종목: 123456/);
});
