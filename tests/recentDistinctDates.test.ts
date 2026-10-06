import test from "node:test";
import assert from "node:assert/strict";
import { fetchRecentDistinctDates } from "../src/services/supabasePaging";

// 하루 3행씩 있는 표를 흉내 낸다: limit(N)이면 같은 날만 나오는 상황
function fakeSupabase(rows: Array<{ trade_date: string }>) {
  let calls = 0;
  return {
    calls: () => calls,
    from() {
      let lt: string | null = null;
      const q: any = {
        select: () => q,
        order: () => q,
        lt: (_c: string, v: string) => ((lt = v), q),
        limit: () => q,
        then(resolve: (v: unknown) => void) {
          calls += 1;
          const sorted = rows.filter((r) => !lt || r.trade_date < lt).sort((a, b) => b.trade_date.localeCompare(a.trade_date));
          resolve({ data: sorted.slice(0, 1), error: null });
        },
      };
      return q;
    },
  };
}

test("fetchRecentDistinctDates: 하루 여러 행이어도 서로 다른 날짜 N개를 최신순으로", async () => {
  const days = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
  const rows = days.flatMap((d) => [{ trade_date: d }, { trade_date: d }, { trade_date: d }]);
  const sb = fakeSupabase(rows);
  assert.deepEqual(await fetchRecentDistinctDates(sb, "pullback_signals", "trade_date", 3), ["2026-10-02", "2026-10-01", "2026-09-30"]);
  assert.deepEqual(await fetchRecentDistinctDates(sb, "pullback_signals", "trade_date", 10), [...days].reverse());
  assert.deepEqual(await fetchRecentDistinctDates(sb, "pullback_signals", "trade_date", 2, { before: "2026-10-01" }), ["2026-09-30", "2026-09-29"]);
});
