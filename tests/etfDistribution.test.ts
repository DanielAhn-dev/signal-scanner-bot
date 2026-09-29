import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDistributionCredit,
  dueDistributions,
  eligibleQuantity,
  exDividendDate,
  parseKodexDistributions,
} from "../src/services/etfDistribution";

const sample = {
  dividList: [
    { basicD: "20260731", dividA: "183", payD: "20260804", taxDividA: "168", dividY: "0.2049" },
    { basicD: "20260430", dividA: "446", payD: "20260506", taxDividA: "446", dividY: "0.4423" },
    { basicD: "bad", dividA: "1", payD: "x" },
  ],
};

test("KODEX API 응답 파싱: 기준일·지급일·주당 금액·과세표준", () => {
  const list = parseKodexDistributions("069500", sample);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { code: "069500", recordDate: "2026-07-31", payDate: "2026-08-04", perShare: 183, taxablePerShare: 168 });
});

test("분배락일은 기준일 전 거래일 (주말 건너뜀)", () => {
  assert.equal(exDividendDate("2026-07-31"), "2026-07-30"); // 금 → 목
  assert.equal(exDividendDate("2026-08-03"), "2026-07-31"); // 월 → 금
});

test("락일 전날까지 산 수량만 받는다", () => {
  const trades = [
    { side: "BUY", quantity: 10, tradedDate: "2026-07-20" },
    { side: "SELL", quantity: 3, tradedDate: "2026-07-25" },
    { side: "BUY", quantity: 5, tradedDate: "2026-07-30" }, // 락일 당일 매수 → 못 받음
  ];
  assert.equal(eligibleQuantity(trades, "2026-07-30"), 7);
});

test("세금은 과세표준에만 15.4%", () => {
  const [jul] = parseKodexDistributions("069500", sample);
  const r = computeDistributionCredit(jul, 27);
  assert.equal(r.gross, 183 * 27);
  assert.equal(r.tax, Math.floor(168 * 27 * 0.154));
  assert.equal(r.net, r.gross - r.tax);
});

test("지급일이 지나고 최근 45일 안이며 아직 안 넣은 것만", () => {
  const list = parseKodexDistributions("069500", sample);
  // 9/29 기준: 8/4 지급분은 45일 밖 → 기능 도입 전 과거분을 한꺼번에 넣지 않는다
  assert.deepEqual(dueDistributions(list, "2026-09-29", []), []);
  assert.equal(dueDistributions(list, "2026-08-05", []).length, 1);
  const done = [{ code: "069500", recordDate: "2026-07-31", payDate: "2026-08-04", quantity: 1, gross: 183, tax: 25, net: 158 }];
  assert.deepEqual(dueDistributions(list, "2026-08-05", done), []);
  assert.deepEqual(dueDistributions(list, "2026-08-03", []), []); // 지급일 전
});
