import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStrategyMemo,
  parseStrategyMemo,
  DEFAULT_STRATEGY_ID,
} from "../src/lib/strategyMemo";

test("strategy memo: structured build and parse roundtrip", () => {
  const memo = buildStrategyMemo({
    strategyId: "core.plan.v1",
    event: "manual-buy",
    note: "watchlist-add",
  });

  const parsed = parseStrategyMemo(memo);
  assert.equal(parsed.strategyId, "core.plan.v1");
  assert.equal(parsed.event, "manual-buy");
  assert.equal(parsed.note, "watchlist-add");
});

test("strategy memo: legacy autotrade memo infers strategy", () => {
  const parsed = parseStrategyMemo("autotrade-take-profit");
  assert.equal(parsed.strategyId, "core.autotrade.v1");
  assert.equal(parsed.event, "autotrade-take-profit");
});

test("strategy memo: unknown memo falls back to default strategy", () => {
  const parsed = parseStrategyMemo("random-note");
  assert.equal(parsed.strategyId, DEFAULT_STRATEGY_ID);
});
