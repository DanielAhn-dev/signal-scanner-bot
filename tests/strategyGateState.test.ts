import test from "node:test";
import assert from "node:assert/strict";
import { resolveStrategyGateStatus, stricterGateStatus } from "../src/services/strategyGateStateService";

test("회차 중 재계산은 더 엄격한 게이트만 남긴다", () => {
  assert.equal(stricterGateStatus("hold", "pause"), "pause");
  assert.equal(stricterGateStatus("pause", "promote"), "pause");
  assert.equal(stricterGateStatus("watch", "hold"), "watch");
  assert.equal(stricterGateStatus(undefined, "hold"), "hold");
  assert.equal(stricterGateStatus("hold", undefined), "hold");
});

test("2026-10-08 손절로 연속손실 4회가 되면 같은 회차에서 중단 후보", () => {
  const before = resolveStrategyGateStatus({ sellCount: 11, winRate: 45.5, profitFactor: 1.3, maxLossStreak: 3, windowDays: 45 });
  const after = resolveStrategyGateStatus({ sellCount: 12, winRate: 41.7, profitFactor: 1.25, maxLossStreak: 4, windowDays: 45 });
  assert.equal(before, "hold");
  assert.equal(stricterGateStatus(before, after), "pause");
});
