import test from "node:test";
import assert from "node:assert/strict";
import { parseEtfKeyIndicator, withListedMarketCap, type EtfKeyIndicator } from "../src/services/etfKeyIndicator";

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

test("순자산은 ETF 전체 목록(억원)을 먼저, 목록에 없으면 종목별 값 유지", () => {
  const base = (marketCap: number | null): EtfKeyIndicator => ({ yieldTtm: 0, fee: 0.01, return1m: null, return3m: null, return1y: null, marketCap, deviation: null });
  const out = withListedMarketCap(
    new Map([["102110", base(null)], ["294400", base(1_437_378_000_000)], ["999999", base(5e10)]]),
    new Map([["102110", 85385], ["294400", 14374]]),
  );
  assert.equal(out.get("102110")?.marketCap, 85385e8);
  assert.equal(out.get("294400")?.marketCap, 14374e8);
  assert.equal(out.get("999999")?.marketCap, 5e10);
  assert.equal(out.get("102110")?.fee, 0.01);
  // 목록을 못 받으면 그대로
  const same = new Map([["102110", base(null)]]);
  assert.equal(withListedMarketCap(same, new Map()), same);
});
