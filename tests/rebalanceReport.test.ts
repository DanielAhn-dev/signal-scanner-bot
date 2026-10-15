import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INCOME_GUIDE_SETTINGS, buildIncomeGuideView, type GuideHolding, type IncomeGuideSettings } from "../src/lib/incomeGuide";
import { buildRebalancePlan } from "../src/lib/rebalancePlan";
import { buildRebalanceReport, estimateSellCost } from "../src/lib/rebalanceReport";
import { renderRebalanceReportHtml } from "../src/services/rebalanceReportRender";

const H = (code: string, name: string, price: number, quantity: number, avgPrice: number | null, account = "a"): GuideHolding => ({
  code,
  name,
  price,
  quantity,
  avgPrice,
  accountKey: account,
  accountLabel: account === "a" ? "키움 / 일반" : "미래 / ISA",
});

function reportFor(holdings: GuideHolding[], settings: Partial<IncomeGuideSettings> = {}, accountKey = "a", market = null as null | { asOf: string; changePct: number; fromHighPct: number }) {
  const s = { ...DEFAULT_INCOME_GUIDE_SETTINGS, customTargets: { income: 65 }, ...settings };
  const view = buildIncomeGuideView({ holdings, settings: s, today: "2026-10-15" });
  const plan = buildRebalancePlan({ holdings: view.holdings, total: view.total, groups: view.groups, settings: s, cashPlan: view.cashPlan });
  return buildRebalanceReport({ view, plan, accountKey, market })!;
}

test("개별주 +20% 이상은 절반을 TR 지수로, 그 아래는 +20% 가격 조건부", () => {
  const r = reportFor([
    H("069500", "KODEX 200", 50_000, 100, 45_000),
    H("278530", "KODEX 200TR", 15_000, 100, 14_000),
    H("005930", "삼성전자", 60_000, 10, 48_000), // +25%
    H("000660", "SK하이닉스", 100_000, 4, 95_000), // +5.3%
  ]);
  const sell = r.sells.find((s) => s.code === "005930")!;
  assert.equal(sell.shares, 5);
  assert.equal(sell.to?.code, "278530", "일반 계좌는 TR형으로 모은다");
  assert.ok(sell.cost >= Math.round(300_000 * 0.002), "개별주 거래세 포함");
  const cond = r.conditionals.find((c) => c.code === "000660")!;
  assert.equal(cond.triggerPrice, 114_000);
  assert.equal(cond.shares, 2);
  assert.equal(r.buy.target?.code, "278530");
});

test("손실 구간 커버드콜은 팔지 않고 평단 회복 조건부로 둔다 (합치기)", () => {
  const r = reportFor([
    H("069500", "KODEX 200", 50_000, 50, 55_000),
    H("498400", "KODEX 200타겟위클리커버드콜", 18_000, 500, 20_000), // 손실
    H("0167B0", "SOL 200타겟위클리커버드콜", 11_000, 100, 12_000), // 손실, 같은 상품 → 합치기 대상
  ]);
  assert.equal(r.sells.length, 0, "손실 종목은 하나도 팔지 않는다");
  const cond = r.conditionals.find((c) => c.code === "0167B0")!;
  assert.equal(cond.triggerPrice, 12_000);
  const row = r.rows.find((x) => x.code === "0167B0")!;
  assert.equal(row.action, "sell-later");
});

test("수익 구간이면 겹치는 커버드콜을 지금 합친다", () => {
  const r = reportFor([
    H("069500", "KODEX 200", 50_000, 50, 45_000),
    H("498400", "KODEX 200타겟위클리커버드콜", 18_000, 500, 17_000),
    H("0167B0", "SOL 200타겟위클리커버드콜", 11_000, 100, 10_500),
  ]);
  const sell = r.sells.find((s) => s.code === "0167B0")!;
  assert.equal(sell.shares, 100);
  assert.equal(sell.to?.code, "498400");
});

test("월 인컴 목표를 넘었거나 커버드콜이 인컴의 1/3을 넘으면 인컴 추가매수 멈춤", () => {
  const r = reportFor(
    [
      H("069500", "KODEX 200", 50_000, 20, 55_000),
      H("498400", "KODEX 200타겟위클리커버드콜", 18_000, 1000, 20_000),
      H("161510", "PLUS 고배당주", 20_000, 100, 22_000),
    ],
    { monthlyNeed: 100_000 },
  );
  assert.ok(r.income.coveredCallShareOfIncomePct > 33);
  assert.ok(r.income.stopReasons.some((s) => s.includes("커버드콜")));
  assert.ok(r.income.stopReasons.some((s) => s.includes("목표")));
  assert.equal(r.rows.find((x) => x.code === "161510")!.action, "stop-add");
  assert.ok(r.income.lines.some((s) => s.includes("C48")), "하락장 인컴 매수 근거를 함께 보여 준다");
});

test("코스피 하락 구간이면 헤드라인에 손실 종목 보유를 밝힌다", () => {
  const r = reportFor([H("069500", "KODEX 200", 50_000, 50, 55_000)], {}, "a", { asOf: "2026-10-15", changePct: -1.2, fromHighPct: -14.3 });
  assert.ok(r.market?.drawdown);
  assert.match(r.headline, /손실 종목은 팔지 않습니다/);
});

test("다른 계좌 종목은 리포트에 넣지 않고, 살 곳도 같은 계좌에서 찾는다", () => {
  const r = reportFor([
    H("278530", "KODEX 200TR", 15_000, 100, 14_000, "a"),
    H("360750", "TIGER 미국S&P500", 20_000, 100, 18_000, "b"),
    H("005930", "삼성전자", 60_000, 10, 48_000, "b"),
  ], {}, "b");
  assert.deepEqual(r.rows.map((x) => x.code).sort(), ["005930", "360750"]);
  assert.equal(r.buy.target?.code, "360750");
  assert.equal(r.account.taxAdvantaged, true);
  assert.equal(r.sells[0].cost, Math.round(300_000 * 0.00015), "ISA 계좌는 거래세·차익세 없이 수수료만");
});

test("일반 계좌 해외 기초 ETF 매도는 차익에 15.4%", () => {
  assert.equal(estimateSellCost({ code: "360750", name: "TIGER 미국S&P500", amount: 1_000_000, gain: 100_000, taxAdvantaged: false }), 150 + 15_400);
  assert.equal(estimateSellCost({ code: "069500", name: "KODEX 200", amount: 1_000_000, gain: 100_000, taxAdvantaged: false }), 150);
});

test("HTML 렌더: 이스케이프하고 주요 섹션을 담는다", () => {
  const r = reportFor([H("069500", "KODEX 200", 50_000, 50, 45_000), H("005930", "삼성<전자>", 60_000, 10, 48_000)]);
  const html = renderRebalanceReportHtml(r, "2026-10-15 10:00");
  assert.match(html, /지금 팔 것/);
  assert.match(html, /실행 순서/);
  assert.ok(!html.includes("삼성<전자>"));
});
