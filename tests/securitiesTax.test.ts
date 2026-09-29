import test from "node:test";
import assert from "node:assert/strict";
import { isExchangeTradedProduct, KRX_SELL_TAX_RATE, resolveBaseSellTaxRate, resolveSellTaxRate, resolveOtherEtfGainTax } from "../src/lib/securitiesTax";

test("securitiesTax: ETF·ETN은 매도 증권거래세 면제", () => {
  assert.equal(isExchangeTradedProduct("459580"), true);
  assert.equal(isExchangeTradedProduct("123456", "TIGER 미국S&P500"), true);
  assert.equal(isExchangeTradedProduct("123456", "RISE 200"), true);
  assert.equal(isExchangeTradedProduct("123456", "신한 레버리지 WTI원유 선물 ETN"), true);
  assert.equal(isExchangeTradedProduct("005930", "삼성전자"), false);
  assert.equal(isExchangeTradedProduct("010950", "S-Oil"), false);
  assert.equal(resolveSellTaxRate({ code: "459580", baseRate: 0.0018 }), 0);
  assert.equal(resolveSellTaxRate({ code: "005930", name: "삼성전자", baseRate: 0.0018 }), 0.0018);
});

test("resolveBaseSellTaxRate: 미설정·예전 기본값(0.18%/0.15%)은 2026 법정세율 0.20%, 직접 고른 값은 유지", () => {
  assert.equal(resolveBaseSellTaxRate(undefined), KRX_SELL_TAX_RATE);
  assert.equal(resolveBaseSellTaxRate(0.0018), 0.002);
  assert.equal(resolveBaseSellTaxRate(0.0015), 0.002);
  assert.equal(resolveBaseSellTaxRate(0.0021), 0.0021);
  assert.equal(resolveBaseSellTaxRate(0), 0);
  assert.equal(resolveBaseSellTaxRate("abc"), 0.002);
});

test("스윕·지수 모드 ETF는 코드만으로도 거래세 0 (이름 없이 매도하는 경로)", () => {
  for (const code of ["122630", "357870", "423160", "102110"]) {
    assert.equal(resolveSellTaxRate({ code, baseRate: 0.002 }), 0, code);
  }
});

test("기타 ETF(레버리지·CD금리)는 매도 이익에 15.4%, 손실·국내주식형 ETF는 0", () => {
  assert.equal(resolveOtherEtfGainTax({ code: "122630", gain: 100_000 }), 15_400);
  assert.equal(resolveOtherEtfGainTax({ code: "459580", gain: 10_000 }), 1_540);
  assert.equal(resolveOtherEtfGainTax({ code: "122630", gain: -50_000 }), 0);
  assert.equal(resolveOtherEtfGainTax({ code: "069500", gain: 100_000 }), 0);
});
