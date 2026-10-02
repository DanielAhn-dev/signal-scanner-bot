import test from "node:test";
import assert from "node:assert/strict";
import { assessAutoTradeDataQuality } from "../src/services/virtualAutoTradeDataQuality";

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
