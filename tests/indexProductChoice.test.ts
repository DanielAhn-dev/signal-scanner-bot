import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INCOME_GUIDE_SETTINGS, buildIncomeGuideView, type GuideHolding, type IncomeGuideSettings } from "../src/lib/incomeGuide";
import { buildRebalancePlan } from "../src/lib/rebalancePlan";
import { buildRebalanceReport } from "../src/lib/rebalanceReport";
import { newMoneyFeeGap, newMoneyFromSettings, pickIndexProduct, type EtfYield, type FeeAlternative } from "../src/lib/indexProductChoice";

const c = (code: string, name: string, fee: number, capEok: number | null, ret: number | null = null) => ({
  code, name, price: 20_000, fee, marketCap: capEok == null ? null : capEok * 1e8, return1y: ret, deviation: 0.05,
});
// 2026-10-02 조사값 (web/src/data/accumulateData.ts)
const KODEX = c("278530", "KODEX 200TR", 0.05, 78_681);
const KIWOOM = c("294400", "KIWOOM 200TR", 0.012, 18_212);
const TIGER = c("361580", "TIGER 200TR", 0.09, 3_653);

test("newMoneyFeeGap: 기간이 길수록 같은 보수 차이가 더 큰 금액이 된다", () => {
  const ten = newMoneyFeeGap(1_000_000, 10, 0.05, 0.012);
  const twenty = newMoneyFeeGap(1_000_000, 20, 0.05, 0.012);
  assert.ok(twenty.won > ten.won * 3, "20년은 10년의 3배 넘게");
  assert.ok(twenty.won / twenty.final > 0.003 && twenty.won / twenty.final < 0.005);
  assert.equal(newMoneyFeeGap(1_000_000, 0, 0.05, 0.012).won, 0);
});

test("newMoneyFromSettings: 월 적립액이 없으면 null, 인컴 시작 월까지 남은 기간, 없으면 10년", () => {
  assert.equal(newMoneyFromSettings({}, "2026-10-19"), null);
  assert.deepEqual(newMoneyFromSettings({ monthlyContribution: 500_000 }, "2026-10-19"), { monthly: 500_000, years: 10, horizonSource: "default" });
  assert.equal(newMoneyFromSettings({ monthlyContribution: 500_000, incomeStart: "2046-10" }, "2026-10-19")!.years, 20);
  assert.equal(newMoneyFromSettings({ monthlyContribution: 500_000, incomeStart: "2020-01" }, "2026-10-19")!.years, 0);
});

test("가진 KODEX 200TR: 오래 모으면 새 돈만 KIWOOM 200TR로, 짧으면 그대로", () => {
  const pool = [KODEX, KIWOOM, TIGER];
  const long = pickIndexProduct(pool, KODEX.code, { monthly: 1_000_000, years: 20, horizonSource: "incomeStart" })!;
  assert.equal(long.chosen.code, KIWOOM.code);
  assert.equal(long.gap?.kept, false);
  assert.match(long.why, /약 \d+만원 덜 냅니다/);
  assert.match(long.notes.get(KODEX.code)!, /팔지 않고 두되/);

  const short = pickIndexProduct(pool, KODEX.code, { monthly: 1_000_000, years: 5, horizonSource: "incomeStart" })!;
  assert.equal(short.chosen.code, KODEX.code);
  assert.equal(short.gap?.kept, true);
  assert.match(short.why, /종류를 늘릴 만큼 크지 않습니다/);

  // 금액 문턱: 비율은 넘어도 10만원이 안 되면 그대로
  const tiny = pickIndexProduct(pool, KODEX.code, { monthly: 30_000, years: 20, horizonSource: "incomeStart" })!;
  assert.equal(tiny.chosen.code, KODEX.code);

  // 월 적립액을 모르면 예전 기준(0.05%p 미만이면 그대로)
  assert.equal(pickIndexProduct(pool, KODEX.code)!.chosen.code, KODEX.code);
  // 처음 사는 사람(보유 없음)은 기간과 무관하게 최적 상품
  assert.equal(pickIndexProduct(pool, null)!.chosen.code, KIWOOM.code);
});

test("보수가 같은 묶음이면 기간이 길어도 가진 상품 그대로 — 1년 수익률로 날마다 바뀌지 않게", () => {
  const a = c("A", "ACE 200TR", 0.012, 5_000, 92.0);
  const b = c("B", "PLUS 200TR", 0.01, 9_000, 92.5);
  const pick = pickIndexProduct([a, b], "A", { monthly: 3_000_000, years: 30, horizonSource: "incomeStart" })!;
  assert.equal(pick.chosen.code, "A");
});

// ── 화면끼리 같은 결과: 리포트와 가이드(①·계좌별·예수금)가 같은 입력이면 같은 상품 ──
const H = (code: string, name: string, price: number, quantity: number, avgPrice: number | null, account = "a"): GuideHolding => ({
  code, name, price, quantity, avgPrice, accountKey: account, accountLabel: account === "a" ? "카카오 / 일반" : "미래 / ISA",
});

function both(settings: Partial<IncomeGuideSettings>) {
  const s = { ...DEFAULT_INCOME_GUIDE_SETTINGS, customTargets: { income: 50 }, cashByAccount: { a: 500_000 }, ...settings };
  const holdings = [
    H(KODEX.code, KODEX.name, 20_000, 300, 15_000),
    H("498400", "KODEX 200타겟위클리커버드콜", 16_000, 300, 15_000),
    H("360750", "TIGER 미국S&P500", 20_000, 100, 18_000, "b"),
  ];
  const today = "2026-10-19";
  const etf = new Map<string, EtfYield>([[KODEX.code, { yieldTtm: 0, fee: KODEX.fee, marketCap: KODEX.marketCap }], ["360750", { yieldTtm: 1, fee: 0.0068, marketCap: 9e12 }]]);
  const alts: FeeAlternative[] = [
    { code: KIWOOM.code, name: KIWOOM.name, price: 20_000, yieldTtm: 0, fee: KIWOOM.fee, marketCap: KIWOOM.marketCap },
    { code: TIGER.code, name: TIGER.name, price: 20_000, yieldTtm: 0, fee: TIGER.fee, marketCap: TIGER.marketCap },
    { code: "379800", name: "KODEX 미국S&P500", price: 20_000, yieldTtm: 1, fee: 0.0062, marketCap: 5e12 },
  ];
  const view = buildIncomeGuideView({ holdings, settings: s, today });
  const plan = buildRebalancePlan({ holdings: view.holdings, total: view.total, groups: view.groups, settings: s, cashPlan: view.cashPlan, today, etf, feeAlternatives: alts })!;
  const reportA = buildRebalanceReport({ view, plan, accountKey: "a", etf, feeAlternatives: alts })!;
  const reportB = buildRebalanceReport({ view, plan, accountKey: "b", etf, feeAlternatives: alts })!;
  return { plan, reportA, reportB };
}

test("리포트·가이드 ①·계좌별 살 곳·예수금 안내가 모두 같은 상품", () => {
  for (const settings of [{}, { monthlyContribution: 1_000_000, incomeStart: "2046-10" }, { monthlyContribution: 1_000_000, incomeStart: "2029-10" }]) {
    const { plan, reportA, reportB } = both(settings);
    const accA = plan.buyTargetsByAccount.find((x) => x.accountKey === "a")!;
    const accB = plan.buyTargetsByAccount.find((x) => x.accountKey === "b")!;
    assert.equal(plan.buyTarget?.code, reportA.buy.target?.code, `① = 리포트 (${JSON.stringify(settings)})`);
    assert.equal(accA.target.code, reportA.buy.target?.code);
    assert.equal(accB.target.code, reportB.buy.target?.code);
    const idle = plan.idleCash?.accounts.find((x) => x.accountKey === "a");
    if (idle?.buyTarget) assert.equal(idle.buyTarget.code, reportA.buy.target?.code, "예수금 안내도 같은 상품");
  }
  // 20년 모으면 새 돈은 KIWOOM, 3년이면 가진 KODEX — 두 화면 모두
  assert.equal(both({ monthlyContribution: 1_000_000, incomeStart: "2046-10" }).plan.buyTarget?.code, KIWOOM.code);
  assert.equal(both({ monthlyContribution: 1_000_000, incomeStart: "2029-10" }).plan.buyTarget?.code, KODEX.code);
  const long = both({ monthlyContribution: 1_000_000, incomeStart: "2046-10" });
  assert.match(long.plan.buyHint, /가진 KODEX 200TR는 팔지 않고/);
  assert.ok(!long.reportA.sells.some((x) => x.code === KODEX.code), "기존 보유는 팔지 않는다");
});
