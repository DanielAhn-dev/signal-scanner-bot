import test from "node:test";
import assert from "node:assert/strict";
import { findMislabeledSells } from "../src/lib/sellLabelAudit";

test("findMislabeledSells: 익절로 기록됐는데 실제 손익이 마이너스인 매도만 찾는다", () => {
  const rows = [
    // 2026-10-01 한미약품: 섹터 정리 매도가 익절로 기록, 수수료·세금 빼면 −3,181원
    { chat_id: 1, code: "128940", reason: "take-profit-partial", created_at: "2026-10-01T00:29:00Z", detail: { pnl: -3181 } },
    { chat_id: 1, code: "005930", reason: "take-profit-final", created_at: "2026-10-01T00:29:00Z", detail: { pnl: 120_000 } },
    { chat_id: 1, code: "000660", reason: "loss-trim", created_at: "2026-10-01T00:29:00Z", detail: { pnl: -50_000 } },
    { chat_id: 1, code: "035420", reason: "take-profit-partial", created_at: "2026-10-01T00:29:00Z", detail: null },
  ];
  assert.deepEqual(findMislabeledSells(rows), [{ chatId: 1, code: "128940", reason: "take-profit-partial", pnl: -3181, at: "2026-10-01" }]);
});
