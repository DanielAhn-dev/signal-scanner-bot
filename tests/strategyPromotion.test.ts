import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPromotionCallback,
  parsePromotionCallback,
  resolveActivationState,
  recordStrategyDecision,
  type StrategyDecision,
} from "../src/services/strategyPromotion";

test("parsePromotionCallback: 버튼 데이터 왕복, 잘못된 값은 무시", () => {
  const data = buildPromotionCallback("approve", "gate-monthly");
  assert.ok(data.length <= 64); // 텔레그램 callback_data 한도
  assert.deepEqual(parsePromotionCallback(data), { action: "approve", strategy: "gate-monthly" });
  assert.equal(parsePromotionCallback("promo:approve:unknown"), null);
  assert.equal(parsePromotionCallback("promo:delete:gate-monthly"), null);
  assert.equal(parsePromotionCallback("cmd:market"), null);
});

test("resolveActivationState: 구현 안 된 전략 승인은 대기로, 보류·해제는 대기에서 뺀다", () => {
  const d = (strategy: any, action: any, at: string): StrategyDecision => ({ strategy, action, at, by: "1", source: "web" });
  const s1 = resolveActivationState([d("gate-monthly", "approve", "2026-11-27T00:00:00Z")]);
  assert.equal(s1.active, null);
  assert.deepEqual(s1.approvedPendingImplementation, ["gate-monthly"]);
  const s2 = resolveActivationState([
    d("gate-monthly", "approve", "2026-11-27T00:00:00Z"),
    d("gate-monthly", "deactivate", "2026-11-28T00:00:00Z"),
  ]);
  assert.deepEqual(s2.approvedPendingImplementation, []);
});

test("recordStrategyDecision: 최신 판정의 승격 후보가 아니면 승인 거부", async () => {
  const snapshot = {
    startDate: "2026-09-28",
    endDate: "2026-11-27",
    generatedAt: "",
    results: [],
    review: { status: "hold", measuredDays: 45, lines: [], candidates: [] },
  };
  let uploaded = false;
  const fake = {
    storage: {
      from: () => ({
        download: async () => ({ data: { text: async () => JSON.stringify(snapshot) }, error: null }),
        upload: async () => {
          uploaded = true;
          return { error: null };
        },
      }),
    },
  };
  const r = await recordStrategyDecision(fake, { strategy: "gate-monthly", action: "approve", by: "1", source: "web" });
  assert.equal(r.ok, false);
  assert.equal(uploaded, false);
});
