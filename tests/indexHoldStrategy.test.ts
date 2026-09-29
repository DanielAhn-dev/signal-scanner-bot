import test from "node:test";
import assert from "node:assert/strict";
import {
  INDEX_HOLD_MODE,
  normalizeStrategyMode,
  planIndexHoldRebalance,
} from "../src/services/indexHoldStrategy";

const prices = new Map<string, number>([
  ["069500", 100_000], // KODEX 200
  ["102110", 100_000], // TIGER 200
  ["122630", 20_000], // KODEX 레버리지
  ["357870", 50_000], // TIGER CD금리
]);

test("모드 값: index_hold, 예전 index_lev15도 지수 보유로, 나머지는 종목 봇", () => {
  assert.equal(normalizeStrategyMode(INDEX_HOLD_MODE), INDEX_HOLD_MODE);
  assert.equal(normalizeStrategyMode("index_lev15"), INDEX_HOLD_MODE);
  assert.equal(normalizeStrategyMode("stock"), "stock");
  assert.equal(normalizeStrategyMode(undefined), "stock");
  assert.equal(normalizeStrategyMode("INDEX"), "stock");
});

test("현금은 전부 KODEX 200 (1주 단위, 수수료 여유분 남김)", () => {
  const plan = planIndexHoldRebalance({ cash: 1_000_000, holdings: [], prices });
  assert.equal(plan.target, "069500");
  assert.deepEqual(plan.sell, []);
  assert.deepEqual(plan.buy, [{ code: "069500", quantity: 9 }]);
});

test("예전 1.5배 모드 보유분(레버리지·금리 ETF)은 팔고 KODEX 200으로 옮긴다", () => {
  const plan = planIndexHoldRebalance({
    cash: 0,
    holdings: [
      { code: "069500", quantity: 5, price: 100_000 },
      { code: "122630", quantity: 25, price: 20_000 },
      { code: "357870", quantity: 2, price: 50_000 },
    ],
    prices,
  });
  assert.deepEqual(plan.sell.map((o) => o.code).sort(), ["122630", "357870"]);
  assert.deepEqual(plan.buy, [{ code: "069500", quantity: 5 }]);
});

test("이미 TIGER 200을 들고 있으면 그대로 두고 그 종목을 더 산다 (왕복 매매 없음)", () => {
  const plan = planIndexHoldRebalance({
    cash: 300_000,
    holdings: [{ code: "102110", quantity: 3, price: 100_000 }],
    prices,
  });
  assert.equal(plan.target, "102110");
  assert.deepEqual(plan.sell, []);
  assert.deepEqual(plan.buy, [{ code: "102110", quantity: 2 }]);
});

test("다 채운 뒤에는 아무것도 하지 않는다 (파는 조건 없음)", () => {
  const plan = planIndexHoldRebalance({
    cash: 50_000,
    holdings: [{ code: "069500", quantity: 10, price: 100_000 }],
    prices,
  });
  assert.deepEqual(plan.sell, []);
  assert.deepEqual(plan.buy, []);
});

test("지수 ETF 가격이 없으면 매매하지 않는다", () => {
  const plan = planIndexHoldRebalance({
    cash: 1_000_000,
    holdings: [{ code: "122630", quantity: 10, price: 20_000 }],
    prices: new Map([["122630", 20_000]]),
  });
  assert.equal(plan.target, null);
  assert.deepEqual(plan.sell, []);
  assert.deepEqual(plan.buy, []);
});
