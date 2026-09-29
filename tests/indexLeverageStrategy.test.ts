import test from "node:test";
import assert from "node:assert/strict";
import {
  INDEX_LEVERAGE_MODE,
  normalizeStrategyMode,
  planIndexModeRebalance,
} from "../src/services/indexLeverageStrategy";

const prices = new Map<string, number>([
  ["069500", 100_000], // KODEX 200
  ["122630", 20_000], // KODEX 레버리지
  ["459580", 1_000_000], // KODEX CD금리 (1주가 비싸다)
  ["357870", 50_000], // TIGER CD금리
]);

test("모드 값: 모르는 값은 종목 봇", () => {
  assert.equal(normalizeStrategyMode(INDEX_LEVERAGE_MODE), INDEX_LEVERAGE_MODE);
  assert.equal(normalizeStrategyMode("stock"), "stock");
  assert.equal(normalizeStrategyMode(undefined), "stock");
  assert.equal(normalizeStrategyMode("INDEX"), "stock");
});

test("50일선 위 + 현금만: 지수와 레버리지를 반반", () => {
  const plan = planIndexModeRebalance({ kospiSma50Ratio: 1.02, cash: 1_000_000, holdings: [], prices });
  assert.equal(plan.regime, "up");
  assert.deepEqual(plan.sell, []);
  assert.deepEqual(plan.buy, [
    { code: "069500", quantity: 4 },
    { code: "122630", quantity: 24 },
  ]);
  const spent = 4 * 100_000 + 24 * 20_000;
  assert.ok(spent <= 1_000_000 / 1.005);
});

test("50일선 아래: 지수·레버리지 전량 매도, 소액 계좌는 살 수 있는 금리 ETF로", () => {
  const plan = planIndexModeRebalance({
    kospiSma50Ratio: 0.97,
    cash: 30_000,
    holdings: [
      { code: "069500", quantity: 4, price: 100_000 },
      { code: "122630", quantity: 24, price: 20_000 },
    ],
    prices,
  });
  assert.equal(plan.regime, "down");
  assert.deepEqual(plan.sell.map((o) => o.code).sort(), ["069500", "122630"]);
  // 1주 100만원인 KODEX CD금리는 못 사므로 TIGER CD금리
  assert.equal(plan.buy.length, 1);
  assert.equal(plan.buy[0].code, "357870");
  assert.equal(plan.buy[0].quantity, 18);
});

test("50일선 판정 불가도 금리 쪽", () => {
  const plan = planIndexModeRebalance({ kospiSma50Ratio: null, cash: 500_000, holdings: [], prices });
  assert.equal(plan.regime, "unknown");
  assert.equal(plan.buy[0].code, "357870");
});

test("구간 안에서는 비율이 틀어져도 팔지 않고, 새 현금만 모자란 쪽에 넣는다", () => {
  // 지수가 올라 레버리지 쪽이 커진 상태 (지수 40만 / 레버리지 70만) + 새 현금 20만
  const plan = planIndexModeRebalance({
    kospiSma50Ratio: 1.05,
    cash: 200_000,
    holdings: [
      { code: "069500", quantity: 4, price: 100_000 },
      { code: "122630", quantity: 35, price: 20_000 },
    ],
    prices,
  });
  assert.deepEqual(plan.sell, []);
  assert.deepEqual(plan.buy, [{ code: "069500", quantity: 1 }]);
});

test("남은 현금은 1주 단위로 채우고, 채운 다음 실행에서는 아무것도 안 한다", () => {
  const first = planIndexModeRebalance({
    kospiSma50Ratio: 1.01,
    cash: 50_000,
    holdings: [
      { code: "069500", quantity: 5, price: 100_000 },
      { code: "122630", quantity: 25, price: 20_000 },
    ],
    prices,
  });
  assert.deepEqual(first.sell, []);
  assert.deepEqual(first.buy, [{ code: "122630", quantity: 1 }]);

  const next = planIndexModeRebalance({
    kospiSma50Ratio: 1.01,
    cash: 30_000,
    holdings: [
      { code: "069500", quantity: 5, price: 100_000 },
      { code: "122630", quantity: 26, price: 20_000 },
    ],
    prices,
  });
  assert.deepEqual(next.sell, []);
  assert.deepEqual(next.buy, []);
});

test("이미 금리 ETF를 들고 있으면 다른 금리 ETF로 바꾸지 않는다", () => {
  const plan = planIndexModeRebalance({
    kospiSma50Ratio: 0.9,
    cash: 0,
    holdings: [{ code: "459580", quantity: 2, price: 1_000_000 }],
    prices,
  });
  assert.deepEqual(plan.sell, []);
  assert.deepEqual(plan.buy, []);
});

test("50일선 위인데 레버리지 종가가 없으면 매매 보류 (1배로 대신 사지 않는다)", () => {
  const noLev = new Map(prices);
  noLev.delete("122630");
  const plan = planIndexModeRebalance({ kospiSma50Ratio: 1.03, cash: 1_000_000, holdings: [], prices: noLev });
  assert.deepEqual(plan.buy, []);
  assert.deepEqual(plan.sell, []);
  assert.match(plan.notes[0], /레버리지/);
});

test("50일선 위로 올라서면 금리 ETF를 팔고 반반으로", () => {
  const plan = planIndexModeRebalance({
    kospiSma50Ratio: 1.01,
    cash: 10_000,
    holdings: [{ code: "357870", quantity: 20, price: 50_000 }],
    prices,
  });
  assert.deepEqual(plan.sell, [{ code: "357870", quantity: 20 }]);
  assert.deepEqual(plan.buy.map((o) => o.code), ["069500", "122630"]);
  const spent = plan.buy.reduce((s, o) => s + o.quantity * prices.get(o.code)!, 0);
  assert.ok(spent <= 1_010_000);
});
