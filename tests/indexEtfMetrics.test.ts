import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeIndexEtfMetrics, type DailyValueBar } from "../src/lib/indexEtfMetrics";
import { parseEtfItemList } from "../src/services/etfMarketList";

const days = (n: number, value: (i: number) => number | null, ticker = "294400"): DailyValueBar[] =>
  Array.from({ length: n }, (_, i) => ({ ticker, date: `2026-09-${String(i + 1).padStart(2, "0")}`, value: value(i) }));

test("거래대금은 최근 20거래일 평균(백만원), 보수·순자산은 지표 그대로(억원)", () => {
  // 25일 중 앞 5일은 10억, 최근 20일은 50억 → 최근 20일만 평균
  const bars = days(25, (i) => (i < 5 ? 1_000_000_000 : 5_000_000_000));
  const out = summarizeIndexEtfMetrics(["294400"], new Map([["294400", { fee: 0.01, marketCap: 1_437_378_000_000 }]]), bars);
  assert.equal(out.asOf, "2026-09-25");
  assert.deepEqual(out.items[0], { code: "294400", feePct: 0.01, marketCapEok: 14374, tradingValueMil: 5000, tradingDays: 20 });
});

test("일봉이 10거래일 미만이면 평균을 내지 않는다(웹은 고정 스냅샷 값 유지)", () => {
  const out = summarizeIndexEtfMetrics(["294400"], new Map(), days(9, () => 5_000_000_000));
  assert.equal(out.items[0].tradingValueMil, null);
  assert.equal(out.items[0].feePct, null);
  assert.equal(out.items[0].marketCapEok, null);
});

test("순자산은 ETF 전체 목록 값을 먼저, 없을 때만 종목별 지표(요청마다 빠지기도 함)", () => {
  const ind = new Map([
    ["102110", { fee: 0.05, marketCap: null }],
    ["294400", { fee: 0.01, marketCap: 1_437_378_000_000 }],
  ]);
  const out = summarizeIndexEtfMetrics(["102110", "294400"], ind, [], new Map([["102110", 85385]]));
  assert.equal(out.items[0].marketCapEok, 85385);
  assert.equal(out.items[1].marketCapEok, 14374);
});

test("ETF 전체 목록 파싱: 코드·순자산만, 이상한 행은 버림", () => {
  const m = parseEtfItemList({ result: { etfItemList: [
    { itemcode: "102110", marketSum: 85385 },
    { itemcode: "BAD", marketSum: 1 },
    { itemcode: "069500", marketSum: null },
  ] } });
  assert.deepEqual([...m], [["102110", 85385]]);
  assert.equal(parseEtfItemList(null).size, 0);
});

test("거래대금이 비면 거래량×종가로 대체, 둘 다 없으면 그날은 뺀다", () => {
  const bars: DailyValueBar[] = [
    ...days(10, () => 2_000_000_000),
    { ticker: "294400", date: "2026-09-11", value: 0, volume: 100_000, close: 20_000 },
    { ticker: "294400", date: "2026-09-12", value: null },
  ];
  const out = summarizeIndexEtfMetrics(["294400"], new Map(), bars);
  assert.equal(out.items[0].tradingDays, 11);
  assert.equal(out.items[0].tradingValueMil, 2000);
  assert.equal(out.asOf, "2026-09-11");
});
