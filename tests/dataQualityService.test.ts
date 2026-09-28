import test from "node:test";
import assert from "node:assert/strict";
import { findLimitBreakingJumps } from "../src/services/dataQualityService";

test("findLimitBreakingJumps: 수정주가 혼재(-56%)는 잡고 상한가(+29.8%)·사후 수정 오차(+33%)는 넘긴다", () => {
  const cal = ["d1", "d2", "d3"];
  const m = new Map([
    ["356860", [{ date: "d1", close: 87000 }, { date: "d2", close: 87500 }, { date: "d3", close: 38300 }]],
    ["066570", [{ date: "d1", close: 181000 }, { date: "d2", close: 235000 }]],
    ["437730", [{ date: "d1", close: 39600 }, { date: "d2", close: 52700 }]],
  ]);
  const jumps = findLimitBreakingJumps(m, cal);
  assert.deepEqual(jumps.map((j) => j.ticker), ["356860"]);
});
