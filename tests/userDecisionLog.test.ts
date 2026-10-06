import test from "node:test";
import assert from "node:assert/strict";
import { changedFields, logUserDecision } from "../handlers/ui/_userDecisionLog";

test("changedFields: 실제로 바뀐 값만, undefined·chat_id는 무시", () => {
  const out = changedFields(
    { chat_id: 1, is_enabled: true, max_positions: 10, stop_loss_pct: 4 },
    { chat_id: 1, is_enabled: false, max_positions: 10, stop_loss_pct: undefined }
  );
  assert.deepEqual(out, { is_enabled: [true, false] });
});

test("changedFields: 이전 설정이 없으면 새 값 전부가 변경", () => {
  assert.deepEqual(changedFields(null, { is_enabled: true }), { is_enabled: [null, true] });
});

test("logUserDecision: run_id 없이 HOLD·user- 사유로 넣고, 실패해도 던지지 않는다", async () => {
  const rows: any[] = [];
  await logUserDecision({ from: () => ({ insert: async (r: any) => rows.push(r) }) }, 7, "mode-switch", { from: "stock", to: "index_hold" });
  assert.equal(rows[0].action_type, "HOLD");
  assert.equal(rows[0].reason, "user-mode-switch");
  assert.equal(rows[0].run_id, null);
  await logUserDecision({ from: () => { throw new Error("x"); } }, 7, "settings", {});
});
