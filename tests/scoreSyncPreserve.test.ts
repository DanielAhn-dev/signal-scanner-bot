import test from "node:test";
import assert from "node:assert/strict";
import { mergeAddOnlyFactors, protectRecordedRow } from "../src/services/scoreSyncService";

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

const fresh = {
  code: "005930",
  asof: "2026-10-02",
  score: 40,
  signal: "HOLD" as const,
  total_score: 40,
  momentum_score: 30,
  liquidity_score: 90,
  value_score: 65,
  factors: { score_source: "engine_pit", rsi14: 70, vol_ratio: 1.2 },
};

test("protectRecordedRow: 기록된 행은 점수·신호를 유지하고 모든 필수 컬럼을 채운다(NOT NULL 업서트 실패 방지)", () => {
  const { row, preserved } = protectRecordedRow(fresh, {
    code: "005930",
    asof: "2026-10-02",
    score: 87,
    signal: "BUY",
    total_score: 87,
    momentum_score: 100,
    liquidity_score: 90,
    value_score: 65,
    factors: { score_source: "legacy_score+engine_factors", rsi14: 55 },
  });
  assert.equal(preserved, true);
  assert.equal(row.score, 87);
  assert.equal(row.signal, "BUY");
  assert.equal(row.total_score, 87);
  assert.equal(row.factors.score_source, "legacy_score+engine_factors");
  assert.equal(row.factors.rsi14, 55);
  assert.equal(row.factors.vol_ratio, 1.2);
});

test("protectRecordedRow: 기존 행이 없거나 engine_pit이면 새 행을 그대로 쓴다", () => {
  assert.equal(protectRecordedRow(fresh, undefined).row, fresh);
  const pit = { ...fresh, score: 10, factors: { score_source: "engine_pit" } };
  assert.equal(protectRecordedRow(fresh, pit).preserved, false);
});
