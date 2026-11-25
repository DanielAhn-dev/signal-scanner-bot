import test from "node:test";
import assert from "node:assert/strict";
import { shouldSkipExistingRun } from "../src/services/virtualAutoTradeRunWindow";

test("shouldSkipExistingRun: 드라이런 기록은 실제 실행을 막지 않는다 (2026-11-25)", () => {
  assert.equal(shouldSkipExistingRun({ dryRun: true }, false), false);
});

test("shouldSkipExistingRun: 실제 실행 기록이 있으면 실제·드라이런 모두 건너뛴다", () => {
  assert.equal(shouldSkipExistingRun({ dryRun: false, buys: 1 }, false), true);
  assert.equal(shouldSkipExistingRun({ dryRun: false }, true), true);
  assert.equal(shouldSkipExistingRun(null, false), true);
});

test("shouldSkipExistingRun: 드라이런끼리는 건너뛴다(기존 동작)", () => {
  assert.equal(shouldSkipExistingRun({ dryRun: true }, true), true);
});
