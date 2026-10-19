import { test } from "node:test";
import assert from "node:assert/strict";
import { matchThemeNews, parseMainNewsList, parseThemeList, parseThemeMembers, themeKeywords } from "../src/lib/marketThemes";
import {
  buildThemeFlow,
  evaluateEvidence,
  linkHoldingToThemes,
  overallEvidence,
  priceTrend,
  rankThemes,
  themeStats,
  type EvidenceSignal,
  type ThemeDay,
  type ThemeMeta,
} from "../src/lib/themeFlow";
import { parseEtfTopHoldings } from "../src/services/marketThemeStore";

const day = (tradeDate: string, themeNo: number, over: Partial<ThemeDay> = {}): ThemeDay => ({
  tradeDate,
  themeNo,
  changeRate: 0,
  riseCount: 5,
  totalCount: 10,
  tradingValue: 1_000,
  newsCount: 0,
  news: [],
  ...over,
});

/** 2026-09-01부터 평일 n개 */
function weekdays(n: number): string[] {
  const out: string[] = [];
  let t = Date.parse("2026-09-01T00:00:00Z");
  while (out.length < n) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

test("themeKeywords: '/'·괄호로 나누고 흔한 낱말은 버린다", () => {
  assert.deepEqual(themeKeywords("피지컬 AI/휴머노이드 로봇"), ["피지컬ai", "휴머노이드로봇"]);
  assert.deepEqual(themeKeywords("광통신(광케이블/광섬유 등)"), ["광통신", "광케이블", "광섬유"]);
  assert.deepEqual(themeKeywords("로봇(산업용/협동로봇 등)"), ["로봇", "협동로봇"]);
  assert.deepEqual(themeKeywords("반도체 재료/부품"), ["반도체재료"]);
  assert.deepEqual(themeKeywords("지능형로봇/인공지능(AI)"), ["지능형로봇", "인공지능"]);
});

test("matchThemeNews: 공백 무시 매칭, 부정 기사를 하나는 남긴다", () => {
  const h = (title: string, at: string) => ({ title, link: `l${at}`, office: "x", at });
  const headlines = [
    h("휴머노이드 로봇 양산 기대 급등", "202610191000"),
    h("휴머노이드로봇 수주 확대 호재", "202610190900"),
    h("휴머노이드 로봇 신고가 돌파", "202610190800"),
    h("휴머노이드 로봇 양산 지연 우려 급락", "202610190700"),
    h("반도체 수출 증가", "202610190600"),
  ];
  const m = matchThemeNews([{ themeNo: 1, name: "피지컬 AI/휴머노이드 로봇" }], headlines).get(1)!;
  assert.equal(m.count, 4);
  assert.equal(m.items.length, 3);
  assert.ok(m.items.some((i) => i.tone === "neg"), "부정 기사가 빠지면 한쪽 기사만 보인다");
});

test("parse: 테마 목록·구성 종목·주요 뉴스·ETF 상위 구성", () => {
  const list = parseThemeList({ groups: [{ no: 449, name: "2차전지(생산)", totalCount: 3, changeRate: "7.49", riseCount: 3, fallCount: 0 }], totalCount: 264, marketStatus: "CLOSE" });
  assert.equal(list.rows[0].changeRate, 7.49);
  assert.equal(list.totalCount, 264);
  const mem = parseThemeMembers({
    stocks: [{ itemCode: "006400", stockName: "삼성SDI", fluctuationsRatio: "10.75", accumulatedTradingValueRaw: "416330000000", localTradedAt: "2026-10-19T13:44:19+09:00" }],
    totalCount: 1,
  });
  assert.equal(mem.members[0].tradingValue, 416_330_000_000);
  assert.equal(mem.members[0].tradedDate, "2026-10-19");
  const news = parseMainNewsList([{ tit: "제목", oid: "015", aid: "0005343936", ohnm: "한국경제", dt: "20261019131912" }]);
  assert.equal(news[0].link, "https://n.news.naver.com/mnews/article/015/0005343936");
  assert.equal(news[0].at, "202610191319");
  const etf = parseEtfTopHoldings({
    etfTop10MajorConstituentAssets: [{ itemCode: "005380", itemName: "현대차", etfWeight: "23.53%" }],
    themeReturns: { themeLargeCodeDesc: "혁신기술", themeMiddleCodeDesc: "로봇" },
  });
  assert.equal(etf?.category, "혁신기술 · 로봇");
  assert.ok(Math.abs(etf!.weights[0].weight - 0.2353) < 1e-9);
  assert.equal(parseEtfTopHoldings({ itemCode: "005930" }), null, "개별주(구성 없음)는 ETF가 아니다");
});

test("themeStats: 5일 복리 등락, 평소 기준이 모자라면 비율은 null", () => {
  const ds = weekdays(3).map((d) => day(d, 1, { changeRate: 10 }));
  const s = themeStats(ds)!;
  assert.ok(Math.abs(s.ret5 - 33.1) < 1e-9);
  assert.equal(s.valueRatio, null);
  assert.equal(s.newsRatio, null);

  const long = weekdays(25).map((d, i) => day(d, 1, { tradingValue: i >= 20 ? 2_000 : 1_000, newsCount: i >= 20 ? 4 : 1 }));
  const s2 = themeStats(long)!;
  assert.equal(s2.valueRatio, 2);
  assert.equal(s2.newsRatio, (4 + 1) / (1 + 1));
});

test("rankThemes: 종목 1~2개 테마는 뺀다", () => {
  const d = "2026-10-19";
  const ranked = rankThemes([
    themeStats([day(d, 1, { changeRate: 30, totalCount: 2, riseCount: 2 })])!,
    themeStats([day(d, 2, { changeRate: 5, riseCount: 9 })])!,
    themeStats([day(d, 3, { changeRate: -3, riseCount: 1 })])!,
  ]);
  assert.deepEqual(ranked.map((r) => r.themeNo), [2, 3]);
});

test("buildThemeFlow: 첫 수집일 테마는 '새로 등장'이 아니고, 10위 안이던 테마가 꺾이면 식는 테마", () => {
  const dates = weekdays(12);
  const days: ThemeDay[] = [];
  // 테마 1: 앞 6일 크게 오르다가 뒤 6일 내림. 나머지 29개 테마는 잔잔
  dates.forEach((d, i) => {
    days.push(day(d, 1, { changeRate: i < 6 ? 8 : -6, riseCount: i < 6 ? 10 : 0 }));
    for (let t = 2; t <= 30; t += 1) days.push(day(d, t, { changeRate: (t % 5) - 2 + (i % 2) * 0.1 }));
  });
  // 테마 99: 마지막 날 처음 등장
  days.push(day(dates[11], 99, { changeRate: 12, riseCount: 10 }));
  const meta: ThemeMeta[] = [
    ...Array.from({ length: 30 }, (_, k) => ({ themeNo: k + 1, name: `T${k + 1}`, memberCodes: [], firstSeen: dates[0] })),
    { themeNo: 99, name: "새 테마", memberCodes: [], firstSeen: dates[11] },
  ];
  const flow = buildThemeFlow(days, meta);
  assert.equal(flow.asOf, dates[11]);
  assert.equal(flow.daysCollected, 12);
  assert.equal(flow.hot[0].themeNo, 99);
  assert.equal(flow.hot[0].isNew, true);
  assert.ok(flow.hot.every((h) => h.themeNo === 99 || !h.isNew));
  const cool = flow.cooling.find((c) => c.themeNo === 1);
  assert.ok(cool, "꺾인 테마 1이 식는 테마에 있어야 한다");
  assert.equal(cool!.peakRank, 1);
});

test("linkHoldingToThemes: 겹침 15% 이상만, 같으면 좁은 테마 먼저", () => {
  const meta: ThemeMeta[] = [
    { themeNo: 1, name: "자동차 대표주", memberCodes: ["005380", "000270", "012330"], firstSeen: "2026-10-19" },
    { themeNo: 2, name: "피지컬 AI/휴머노이드 로봇", memberCodes: ["277810", "454910", "108490", "005380"], firstSeen: "2026-10-19" },
    { themeNo: 3, name: "넓은 테마", memberCodes: ["277810", "454910", "108490", "a", "b", "c", "d"].map((x) => x.padStart(6, "0")), firstSeen: "2026-10-19" },
  ];
  const w = [
    { code: "005380", name: "현대차", weight: 0.2353 },
    { code: "000270", name: "기아", weight: 0.1466 },
    { code: "012330", name: "현대모비스", weight: 0.1298 },
    { code: "277810", name: "레인보우로보틱스", weight: 0.0691 },
    { code: "454910", name: "두산로보틱스", weight: 0.0385 },
    { code: "108490", name: "로보티즈", weight: 0.0341 },
  ];
  const links = linkHoldingToThemes(w, meta);
  assert.equal(links[0].themeNo, 1);
  assert.ok(Math.abs(links[0].overlap - 0.5117) < 1e-9);
  assert.equal(links[1].themeNo, 2);
  assert.equal(linkHoldingToThemes([{ code: "999999", name: "x", weight: 1 }], meta).length, 0);
});

test("priceTrend: 3달 등락·200일선", () => {
  const up = Array.from({ length: 220 }, (_, i) => 100 + i);
  const t = priceTrend(up);
  assert.equal(t.aboveMa200, true);
  assert.ok(t.ret3m! > 0);
  const short = priceTrend([1, 2, 3]);
  assert.equal(short.ret3m, null);
  assert.equal(short.aboveMa200, null);
});

test("overallEvidence: 가격 하나만으로는 약함이 되지 않는다", () => {
  const s = (key: EvidenceSignal["key"], level: EvidenceSignal["level"]): EvidenceSignal => ({ key, label: key, level, detail: "" });
  assert.equal(overallEvidence([s("price", "weak"), s("breadth", "normal"), s("news", "unknown"), s("value", "unknown")]), "mixed");
  assert.equal(overallEvidence([s("price", "weak"), s("breadth", "weak"), s("news", "normal"), s("value", "unknown")]), "weak");
  assert.equal(overallEvidence([s("price", "weak"), s("breadth", "weak"), s("news", "strong"), s("value", "unknown")]), "mixed");
  assert.equal(overallEvidence([s("price", "strong"), s("breadth", "unknown"), s("news", "unknown"), s("value", "unknown")]), "pending");
  assert.equal(overallEvidence([s("breadth", "strong"), s("news", "strong"), s("price", "normal"), s("value", "unknown")]), "strong");
});

test("evaluateEvidence: 테마 기록이 없으면 판단 보류", () => {
  const r = evaluateEvidence({ price: { ret3m: -12, aboveMa200: false, bars: 250 }, theme: null });
  assert.equal(r.overall, "pending");
  assert.equal(r.signals.find((x) => x.key === "price")!.level, "weak");
});
