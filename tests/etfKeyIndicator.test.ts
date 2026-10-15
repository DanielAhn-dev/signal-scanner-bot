import test from "node:test";
import assert from "node:assert/strict";
import { parseEtfKeyIndicator } from "../src/services/etfKeyIndicator";

test("네이버 integration 응답에서 분배율·보수·수익률을 숫자로", () => {
  const k = parseEtfKeyIndicator({
    etfKeyIndicator: { dividendYieldTtm: 5.51, totalFee: 0.15, returnRate1m: -3.0, returnRate3m: "-3.74", returnRate1y: 33.99, nav: "12,618.67" },
  });
  assert.deepEqual(k, { yieldTtm: 5.51, fee: 0.15, return1m: -3, return3m: -3.74, return1y: 33.99, marketCap: null, deviation: null });
});

test("시가총액·괴리율(부호)", () => {
  const k = parseEtfKeyIndicator({
    etfKeyIndicator: { totalFee: 0.05, marketValueRaw: "6100697000000", deviationSign: "-", deviationRate: 0.11 },
  });
  assert.equal(k?.marketCap, 6_100_697_000_000);
  assert.equal(k?.deviation, -0.11);
});

test("ETF 지표가 없으면 null", () => {
  assert.equal(parseEtfKeyIndicator({ stockName: "삼성전자" }), null);
  assert.equal(parseEtfKeyIndicator(null), null);
});
