import test from "node:test";
import assert from "node:assert/strict";
import { computeFlowScore, pickHeavyNetSelling } from "../src/services/investorFlowFilter";

test("computeFlowScore: 최근 5일 외국인+기관 순매수 / 평균 거래대금", () => {
  const flows = Array.from({ length: 7 }, () => ({ foreign: -30, institution: -20 }));
  assert.equal(computeFlowScore({ flows, avgTradedValue: 1000 }), -0.25);
  assert.equal(computeFlowScore({ flows: flows.slice(0, 3), avgTradedValue: 1000 }), null);
  assert.equal(computeFlowScore({ flows, avgTradedValue: 0 }), null);
});

test("pickHeavyNetSelling: 그날 하위 20% 중 순매도 종목만 제외", () => {
  const scores = new Map(Array.from({ length: 10 }, (_, i) => [`c${i}`, i - 1] as [string, number]));
  assert.deepEqual([...pickHeavyNetSelling(scores).keys()], ["c0"]); // c0=-1 순매도, c1=0은 제외 안 함
});
