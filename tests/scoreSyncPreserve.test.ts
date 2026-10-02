import test from "node:test";
import assert from "node:assert/strict";
import { mergeAddOnlyFactors } from "../src/services/scoreSyncService";

test("mergeAddOnlyFactors: 기존 값은 유지하고 없는 키만 채운다", () => {
  const merged = mergeAddOnlyFactors(
    { score_source: "legacy_score+engine_factors", rsi14: 55, stable_turn: null },
    { score_source: "engine_pit", rsi14: 70, stable_turn: 3, stable_support: 9 }
  );
  assert.equal(merged.score_source, "legacy_score+engine_factors");
  assert.equal(merged.rsi14, 55);
  assert.equal(merged.stable_turn, 3);
  assert.equal(merged.stable_support, 9);
});

test("mergeAddOnlyFactors: 기존 팩터가 없어도 동작", () => {
  assert.deepEqual(mergeAddOnlyFactors(null, { a: 1 }), { a: 1 });
});
