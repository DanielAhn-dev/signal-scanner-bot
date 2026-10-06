import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  getTruncationEvents,
  installSupabaseTruncationGuard,
  isLikelyTruncated,
  resetTruncationEventsForTest,
} from "../src/lib/supabaseTruncationGuard";

test("isLikelyTruncated: 정확히 1000행이고 limit이 없거나 1000 초과면 잘림", () => {
  assert.equal(isLikelyTruncated(1000, "http://x/rest/v1/t?select=*"), true);
  assert.equal(isLikelyTruncated(1000, "http://x/rest/v1/t?select=*&limit=5000"), true);
  assert.equal(isLikelyTruncated(1000, "http://x/rest/v1/t?select=*&offset=0&limit=1000"), false);
  assert.equal(isLikelyTruncated(999, "http://x/rest/v1/t?select=*"), false);
});

test("installSupabaseTruncationGuard: 실제 supabase-js 조회에서 잘림만 기록하고 결과는 그대로 돌려준다", async () => {
  resetTruncationEventsForTest();
  installSupabaseTruncationGuard();
  installSupabaseTruncationGuard(); // 두 번 불러도 한 번만 감싼다
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
  const fakeFetch = async () =>
    new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json", "content-range": "0-999/*" } });
  const sb = createClient("http://guard.test", "k", { auth: { persistSession: false }, global: { fetch: fakeFetch as any } });

  const truncated = await sb.from("stock_daily").select("ticker").in("ticker", ["a", "b"]).limit(5000);
  assert.equal(truncated.data?.length, 1000);
  const paged = await sb.from("stock_daily").select("ticker").range(0, 999);
  assert.equal(paged.data?.length, 1000);

  const events = getTruncationEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].table, "stock_daily");
  assert.match(events[0].query, /limit=5000/);

  // 같은 쿼리는 한 번만 기록
  await sb.from("stock_daily").select("ticker").in("ticker", ["a", "b"]).limit(5000);
  assert.equal(getTruncationEvents().length, 1);
});
