import test from "node:test";
import assert from "node:assert/strict";
import { assessAutoTradeDataQuality, assessGuardLoadFailures } from "../src/services/virtualAutoTradeDataQuality";
import { splitCandidatesByCloseFreshness } from "../src/services/virtualAutoTradeSelection";

test("데이터 품질: 지연이 없어도 부분 적재면 신규 매수 차단", () => {
  const ok = assessAutoTradeDataQuality({ scoreStaleBusinessDays: 0, investorStaleBusinessDays: 0 });
  assert.equal(ok.blockNewBuys, false);
  const partial = assessAutoTradeDataQuality({
    scoreStaleBusinessDays: 0,
    investorStaleBusinessDays: 0,
    partialLoadLabels: ["종목 점수"],
  });
  assert.equal(partial.blockNewBuys, true);
  assert.match(partial.note, /종목 점수/);
});

test("매수 제외 필터 조회 실패: 하나라도 실패하면 신규 매수 보류, 모두 성공이면 통과", () => {
  assert.equal(assessGuardLoadFailures([]).blockNewBuys, false);
  assert.equal(assessGuardLoadFailures(["", "  "]).blockNewBuys, false);
  const failed = assessGuardLoadFailures(["실적 관문", "실적 관문", "순매도"]);
  assert.equal(failed.blockNewBuys, true);
  assert.match(failed.note, /실적 관문, 순매도/);
});

test("후보 종가 신선도: 오래됐거나 동결됐거나 자료 없는 후보만 뺀다", () => {
  const now = Date.parse("2026-11-02T00:00:00Z");
  const day = (d: string, close: number) => ({ date: d, close, volume: 1000 });
  const history = new Map([
    ["FRESH", [day("2026-11-02", 105), day("2026-10-30", 100), day("2026-10-29", 99), day("2026-10-28", 98)]],
    ["STALE", [day("2026-10-20", 105), day("2026-10-19", 100)]],
    ["FROZEN", [day("2026-11-02", 50), day("2026-10-30", 50), day("2026-10-29", 50), day("2026-10-28", 50)]],
  ]);
  const { fresh, excluded } = splitCandidatesByCloseFreshness(
    [{ code: "FRESH" }, { code: "STALE" }, { code: "FROZEN" }, { code: "NONE" }],
    history,
    { nowMs: now }
  );
  assert.deepEqual(fresh.map((c) => c.code), ["FRESH"]);
  assert.deepEqual(
    excluded.map((e) => `${e.code}:${e.reason}`),
    ["STALE:stale-date", "FROZEN:frozen-close", "NONE:no-data"]
  );
});
