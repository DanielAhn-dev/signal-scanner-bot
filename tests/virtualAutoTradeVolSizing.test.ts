import test from "node:test";
import assert from "node:assert/strict";
import { volatilityBudgetCap } from "../src/services/virtualAutoTradeVolSizing";

test("volatilityBudgetCap: 지수보다 유난히 흔들리는 종목은 기준액보다 적게", () => {
  // volRatio 5.02 → 배수 0.5
  const r = volatilityBudgetCap({ baseBudget: 4_000_000, floor: 1_000_000, stockVol60: 0.05, indexVol60: 0.00996 });
  assert.ok(r);
  assert.ok(Math.abs(r!.multiple - 0.5) < 0.01);
  assert.ok(Math.abs(r!.cap - 2_000_000) < 20_000);
});

test("volatilityBudgetCap: 배수는 2배를 넘지 않고, 의미 있는 최소 크기 아래로는 안 깎는다", () => {
  const calm = volatilityBudgetCap({ baseBudget: 4_000_000, floor: 1_000_000, stockVol60: 0.005, indexVol60: 0.01 });
  assert.equal(calm?.multiple, 2);
  assert.equal(calm?.cap, 8_000_000);
  const wild = volatilityBudgetCap({ baseBudget: 4_000_000, floor: 1_000_000, stockVol60: 0.2, indexVol60: 0.01 });
  assert.equal(wild?.cap, 1_000_000);
});

test("volatilityBudgetCap: 변동성 자료가 없으면 적용하지 않는다", () => {
  assert.equal(volatilityBudgetCap({ baseBudget: 4_000_000, floor: 0, stockVol60: null, indexVol60: 0.01 }), null);
  assert.equal(volatilityBudgetCap({ baseBudget: 4_000_000, floor: 0, stockVol60: 0.02, indexVol60: undefined }), null);
  assert.equal(volatilityBudgetCap({ baseBudget: 0, floor: 0, stockVol60: 0.02, indexVol60: 0.01 }), null);
});
