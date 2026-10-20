import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isExchangeTradedProduct,
  KRX_SELL_TAX_RATE,
  resolveBaseSellTaxRate,
  resolveEtfTaxClass,
  resolveSellTaxRate,
  resolveOtherEtfGainTax,
} from "../src/lib/securitiesTax";
import { PROFILE_ETFS } from "../src/services/coreProfiles";

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

test("stocks.product_type이 있으면 이름보다 먼저: stock이면 브랜드 이름이어도 개별주, etf면 이름 없이도 ETF", () => {
  assert.equal(isExchangeTradedProduct("123456", "KODEX 200", "stock"), false);
  assert.equal(isExchangeTradedProduct("123456", "새 운용사 200", "etf"), true);
  assert.equal(isExchangeTradedProduct("123456", "어떤 ETN", "etn"), true);
  // other·미확인은 지금처럼 이름으로
  assert.equal(isExchangeTradedProduct("123456", "KODEX 200", "other"), true);
  assert.equal(isExchangeTradedProduct("123456", "KODEX 200", null), true);
  assert.equal(resolveSellTaxRate({ code: "123456", name: "새 운용사 200", productType: "etf", baseRate: 0.002 }), 0);
});

test("resolveEtfTaxClass: DB etf_tax_class가 이름 규칙보다 먼저", () => {
  // 이름만 보면 '글로벌'이라 기타지만 국내 종목 ETF — DB 값(네이버 분류)을 따른다
  assert.equal(resolveEtfTaxClass({ code: "000001", name: "KODEX 코스닥글로벌", productType: "etf", etfTaxClass: "domestic_equity" }), "domestic_equity");
  // 이름에 나라가 없는 해외 ETF — DB 값이 있으면 기타
  assert.equal(resolveEtfTaxClass({ code: "000002", name: "ACE 테슬라밸류체인액티브", productType: "etf", etfTaxClass: "other" }), "other");
  assert.equal(resolveEtfTaxClass({ code: "000002", name: "ACE 테슬라밸류체인액티브" }), "domestic_equity");
  assert.equal(resolveOtherEtfGainTax({ code: "000002", name: "ACE 테슬라밸류체인액티브", etfTaxClass: "other", gain: 100_000 }), 15_400);
});

test("resolveEtfTaxClass: 개별주·ETN은 null, 이름 규칙은 해외·채권·금·파생을 기타로", () => {
  assert.equal(resolveEtfTaxClass({ code: "005930", name: "삼성전자" }), null);
  assert.equal(resolveEtfTaxClass({ code: "005930", name: "삼성전자", productType: "stock", etfTaxClass: "other" }), null);
  assert.equal(resolveEtfTaxClass({ code: "500001", name: "신한 레버리지 WTI원유 선물 ETN" }), null);
  assert.equal(resolveEtfTaxClass({ code: "500001", name: "어떤 상품", productType: "etn" }), null);
  for (const name of ["TIGER 미국S&P500", "KIWOOM 국고채10년", "ACE KRX금현물", "KODEX 미국10년국채선물", "KODEX 200선물인버스2X", "KODEX 삼성전자단일종목레버리지", "TIME 글로벌AI인공지능액티브"]) {
    assert.equal(resolveEtfTaxClass({ code: "", name }), "other", name);
  }
  for (const name of ["KODEX 200", "KODEX 200TR", "KODEX 반도체", "TIME 코스피액티브", "KoAct 배당성장액티브", "BNK 주주가치액티브"]) {
    assert.equal(resolveEtfTaxClass({ code: "", name }), "domestic_equity", name);
  }
  // "금융"은 금이 아니다
  assert.equal(resolveEtfTaxClass({ code: "", name: "KODEX 금융" }), "domestic_equity");
});

test("기타 ETF 매매차익세: 해외·채권·금 ETF도 이름만으로 15.4% (예전엔 코드 4개만)", () => {
  assert.equal(resolveOtherEtfGainTax({ code: "360750", name: "TIGER 미국S&P500", gain: 100_000 }), 15_400);
  assert.equal(resolveOtherEtfGainTax({ code: "148070", name: "KIWOOM 국고채10년", gain: 100_000 }), 15_400);
  assert.equal(resolveOtherEtfGainTax({ code: "411060", name: "ACE KRX금현물", gain: 100_000 }), 15_400);
  // 코드만 넘기는 예전 호출은 그대로
  assert.equal(resolveOtherEtfGainTax({ code: "360750", gain: 100_000 }), 0);
  assert.equal(resolveOtherEtfGainTax({ code: "102110", gain: 100_000 }), 0);
});

test("DB가 비어도 갈라지지 않게: 추천 ETF·코어 프로필 이름 규칙 = 마이그레이션 036 시드(네이버 분류)", () => {
  const sql = readFileSync(join(__dirname, "..", "db", "migrations", "036_stock_product_type.sql"), "utf-8");
  const seeded = new Map([...sql.matchAll(/\('(\w{6})', ([1-7])\)/g)].map((m) => [m[1], Number(m[2]) <= 2 ? "domestic_equity" : "other"]));
  const listed: Array<{ code: string; name: string }> = JSON.parse(
    readFileSync(join(__dirname, "..", "scripts", "recommended_etfs.json"), "utf-8"),
  ).etfs;
  const names = new Map<string, string>([...listed.map((e) => [e.code, e.name] as [string, string]), ...Object.entries(PROFILE_ETFS)]);
  assert.ok(names.size >= 22);
  for (const [code, name] of names) {
    // 036 이후 추가된 ETF는 시드가 없다 — 이름 규칙이 ETF로 알아보는지만 본다(분류는 배치가 채운다)
    const got = resolveEtfTaxClass({ code, name });
    if (seeded.has(code)) assert.equal(got, seeded.get(code), `${code} ${name}`);
    else assert.notEqual(got, null, `${code} ${name}`);
  }
});
