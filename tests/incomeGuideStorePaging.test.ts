import test from "node:test";
import assert from "node:assert/strict";
import { loadAccountPositionRows } from "../src/services/incomeGuideStore";

// 1000행 단위로만 돌려주는 PostgREST를 흉내 낸다 — range를 지키지 않으면 1000행에서 끝난다
function fakeSupabase(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({
    id: i + 1, chat_id: 7, code: String(100000 + i), quantity: 1, buy_price: 100, status: i % 10 === 0 ? "closed" : "holding",
    broker_name: "토스", account_name: "일반", stock: null,
  }));
  const builder: any = {
    select: () => builder, gt: () => builder, or: () => builder, order: () => builder, eq: () => builder,
    range: async (from: number, to: number) => ({ data: rows.slice(from, Math.min(to, from + 999) + 1), error: null }),
  };
  return { from: () => builder };
}

test("계좌 보유가 1000행을 넘어도 끝까지 읽고 청산 행만 거른다", async () => {
  const out = await loadAccountPositionRows(fakeSupabase(2500), 7);
  assert.equal(out.length, 2500 - 250);
  assert.ok(out.every((r) => r.status !== "closed"));
});
