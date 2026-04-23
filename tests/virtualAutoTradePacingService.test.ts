import test from "node:test";
import assert from "node:assert/strict";
import {
  derivePacingRelaxLevel,
  derivePacingState,
} from "../src/services/virtualAutoTradePacingService";

test("derivePacingState: 목표 대비 앞서면 ahead", () => {
  const state = derivePacingState({ monthReturnPct: 1.0, targetMonthlyPct: 0.8 });
  assert.equal(state, "ahead");
});

test("derivePacingState: 목표 근처면 on-track", () => {
  const state = derivePacingState({ monthReturnPct: 0.6, targetMonthlyPct: 0.8 });
  assert.equal(state, "on-track");
});

test("derivePacingState: 목표 크게 미달이면 behind", () => {
  const state = derivePacingState({ monthReturnPct: 0.2, targetMonthlyPct: 0.8 });
  assert.equal(state, "behind");
});

test("derivePacingRelaxLevel: behind + 장기 무매수면 레벨2", () => {
  const level = derivePacingRelaxLevel({
    state: "behind",
    runCount: 10,
    buyActions: 0,
  });
  assert.equal(level, 2);
});

test("derivePacingRelaxLevel: behind 일반 구간은 레벨1", () => {
  const level = derivePacingRelaxLevel({
    state: "behind",
    runCount: 4,
    buyActions: 1,
  });
  assert.equal(level, 1);
});

test("derivePacingRelaxLevel: on-track/ahead는 레벨0", () => {
  assert.equal(derivePacingRelaxLevel({ state: "on-track" }), 0);
  assert.equal(derivePacingRelaxLevel({ state: "ahead" }), 0);
});
