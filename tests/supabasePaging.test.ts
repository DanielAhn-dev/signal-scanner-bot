import test from "node:test";
import assert from "node:assert/strict";

test("selectAllSettled는 1000행 상한을 넘겨도 끝까지 받고 오류는 data null로 돌려준다", async () => {
  const { selectAllSettled } = await import("../src/services/supabasePaging");
  const all = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
  const ok = await selectAllSettled<{ id: number }>(async (a, b) => ({ data: all.slice(a, Math.min(b, a + 999) + 1), error: null }));
  assert.equal(ok.error, null);
  assert.equal(ok.data?.length, 2500);
  const bad = await selectAllSettled<{ id: number }>(async () => ({ data: null, error: { message: "boom" } }));
  assert.equal(bad.data, null);
  assert.equal(bad.error?.message, "boom");
});
