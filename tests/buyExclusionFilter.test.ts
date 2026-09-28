import test from "node:test";
import assert from "node:assert/strict";
import { fetchBuyExclusions } from "../src/services/buyExclusionFilter";
import { isCashSweepCode } from "../src/services/cashSweepBalance";

test("fetchBuyExclusions: ETF·ETN은 제외, 수급·공시 조회 실패는 제외 없이 통과", async () => {
  const brokenSupabase = {}; // 수급 조회가 실패해도 리포트 생성은 막지 않는다
  const result = await fetchBuyExclusions(brokenSupabase, [
    { code: "459580", name: "KODEX CD금리액티브(합성)" },
    { code: "123456", name: "TIGER 반도체" },
    { code: "005930", name: "삼성전자" },
  ]);
  assert.deepEqual([...result.codes].sort(), ["123456", "459580"]);
  assert.equal(result.reasons.get("459580"), "ETF·ETN");
  assert.equal(result.codes.has("005930"), false);
});

test("isCashSweepCode: 현금 스윕 ETF만 참", () => {
  assert.equal(isCashSweepCode("459580"), true);
  assert.equal(isCashSweepCode(" 423160 "), true);
  assert.equal(isCashSweepCode("005930"), false);
  assert.equal(isCashSweepCode(null), false);
});
