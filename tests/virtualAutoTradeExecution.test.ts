import test from "node:test";
import assert from "node:assert/strict";
import { resolveVirtualExecutionPrice } from "../src/services/virtualAutoTradeExecution";

test("virtual execution: 매수는 기준가보다 불리하게 체결된다", () => {
  const result = resolveVirtualExecutionPrice({
    referencePrice: 100_000,
    side: "BUY",
  });

  assert.equal(result.executionPrice, 100_100);
  assert.equal(result.slippageAmount, 100);
  assert.equal(result.slippageBps, 10);
});

test("virtual execution: 매도는 기준가보다 불리하게 체결된다", () => {
  const result = resolveVirtualExecutionPrice({
    referencePrice: 100_000,
    side: "SELL",
    slippageBps: 25,
  });

  assert.equal(result.executionPrice, 99_750);
  assert.equal(result.slippageAmount, -250);
});

test("virtual execution: 음수와 과도한 슬리피지는 제한한다", () => {
  const result = resolveVirtualExecutionPrice({
    referencePrice: 100_000,
    side: "BUY",
    slippageBps: 10_000,
  });

  assert.equal(result.executionPrice, 105_000);
  assert.equal(result.slippageBps, 500);
});