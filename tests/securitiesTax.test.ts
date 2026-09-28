import test from "node:test";
import assert from "node:assert/strict";
import { isExchangeTradedProduct, resolveSellTaxRate } from "../src/lib/securitiesTax";

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
