import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INCOME_GUIDE_SETTINGS,
  buildIncomeGuideView,
  classifyHolding,
  isTaxAdvantagedAccount,
  resolveStageTargets,
  sanitizeIncomeGuideSettings,
  type GuideHolding,
} from "../src/lib/incomeGuide";

test("classifyHolding: 이름 규칙으로 바구니를 나눈다", () => {
  assert.equal(classifyHolding("069500", "KODEX 200"), "kr_index");
  assert.equal(classifyHolding("229200", "KODEX 코스닥150"), "kr_index");
  assert.equal(classifyHolding("433330", "SOL 미국S&P500"), "global_index");
  assert.equal(classifyHolding("133690", "TIGER 미국나스닥100"), "global_index");
  assert.equal(classifyHolding("161510", "PLUS 고배당주"), "dividend");
  assert.equal(classifyHolding("402970", "ACE 미국배당다우존스"), "dividend");
  // 배당이 들어가도 커버드콜이면 커버드콜
  assert.equal(classifyHolding("489030", "PLUS 고배당주위클리커버드콜"), "covered_call");
  assert.equal(classifyHolding("475720", "RISE 200위클리커버드콜"), "covered_call");
  assert.equal(classifyHolding("088980", "맥쿼리인프라"), "reit_infra");
  assert.equal(classifyHolding("293940", "신한알파리츠"), "reit_infra");
  // 인프라라는 말이 들어간 테마 ETF는 인컴이 아니다
  assert.equal(classifyHolding("487230", "KODEX 미국AI전력핵심인프라"), "other_etf");
  assert.equal(classifyHolding("153130", "KODEX 단기채권"), "bond_cash");
  assert.equal(classifyHolding("459580", "KODEX CD금리액티브(합성)"), "bond_cash");
  assert.equal(classifyHolding("448330", "KODEX 삼성전자채권혼합"), "other_etf");
  assert.equal(classifyHolding("122630", "KODEX 레버리지"), "leveraged");
  assert.equal(classifyHolding("086790", "하나금융지주"), "stock");
  assert.equal(classifyHolding("091160", "KODEX 반도체"), "other_etf");
});

test("isTaxAdvantagedAccount: 계좌 이름으로 ISA·연금을 알아본다", () => {
  assert.equal(isTaxAdvantagedAccount("키움 / ISA"), true);
  assert.equal(isTaxAdvantagedAccount("미래에셋 / 연금저축"), true);
  assert.equal(isTaxAdvantagedAccount("KDB / 일반"), false);
});

test("resolveStageTargets: 인컴 시작 5년 전부터 매년 계단식으로 분배형을 늘린다", () => {
  const base = { ...DEFAULT_INCOME_GUIDE_SETTINGS, monthlyNeed: 500_000 };
  const total = 150_000_000; // 연 600만 ÷ 4.5% = 1.33억 → 인컴 단계 분배형 목표 약 89% → 상한 70%
  const acc = resolveStageTargets({ settings: { ...base }, total, today: "2026-10-01" });
  assert.equal(acc.stage, "accumulate");
  assert.equal(acc.incomePct, 10);
  assert.equal(acc.cashPct, 0);
  const far = resolveStageTargets({ settings: { ...base, incomeStart: "2036-10" }, total, today: "2026-10-01" });
  assert.equal(far.stage, "accumulate");
  const five = resolveStageTargets({ settings: { ...base, incomeStart: "2031-09" }, total, today: "2026-10-01" });
  assert.equal(five.stage, "transition");
  assert.ok(Math.abs(five.incomePct - (10 + (70 - 10) / 5)) < 1e-9);
  const one = resolveStageTargets({ settings: { ...base, incomeStart: "2027-06" }, total, today: "2026-10-01" });
  assert.equal(one.stage, "transition");
  assert.equal(one.incomePct, 70);
  const now = resolveStageTargets({ settings: { ...base, incomeStart: "2026-10" }, total, today: "2026-10-01" });
  assert.equal(now.stage, "income");
  assert.equal(now.incomePct, 70);
  assert.equal(now.cashPct, 5); // 600만 ÷ 1.5억 = 4% → 최소 5%
});

const h = (code: string, name: string, value: number, account = "키움 / 일반"): GuideHolding => ({
  code,
  name,
  quantity: 1,
  price: value,
  accountKey: account,
  accountLabel: account,
});

test("buildIncomeGuideView: 모으기 단계에서 국내 지수에 몰린 계좌는 해외·분배형으로 옮기라고 안내한다", () => {
  const view = buildIncomeGuideView({
    holdings: [h("069500", "KODEX 200", 80_000_000), h("005930", "삼성전자", 20_000_000)],
    settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS },
    today: "2026-10-01",
  });
  assert.equal(view.total, 100_000_000);
  assert.equal(view.stage.key, "accumulate");
  const g = Object.fromEntries(view.groups.map((r) => [r.group, r]));
  // 위성 20%는 상한 10% 초과 → 목표 10%, 인컴 10%, 성장 80%
  assert.equal(g.satellite.targetPct, 10);
  assert.equal(g.income.targetPct, 10);
  assert.equal(g.growth.targetPct, 80);
  assert.equal(g.satellite.diffAmount, -10_000_000);
  assert.equal(g.income.diffAmount, 10_000_000);
  assert.deepEqual(view.rebalance.moves, [{ from: "satellite", to: "income", amount: 10_000_000 }]);
  // 성장 바구니가 전부 국내 → 해외 비중 0% vs 목표 50%라 지금 옮기라고 한다
  assert.equal(view.rebalance.needed, true);
  assert.ok(view.warnings.some((w) => w.title.includes("국내에 몰려")));
  assert.ok(view.warnings.some((w) => w.title.includes("삼성전자 한 종목이 20%")) === false); // 20%는 초과가 아니다
  assert.ok(view.warnings.some((w) => w.title.startsWith("위성 20%")));
  assert.equal(view.rebalance.trims[0].holdings[0].code, "005930");
  // 리밸런싱 뒤 성장 8,000만의 절반 4,000만을 해외로
  assert.deepEqual(view.rebalance.growthShift, { to: "global_index", amount: 40_000_000 });
});

test("buildIncomeGuideView: 인컴 단계에서 커버드콜·일반 계좌 과세 ETF·높은 인출률을 경고한다", () => {
  const view = buildIncomeGuideView({
    holdings: [
      h("475720", "RISE 200위클리커버드콜", 30_000_000),
      h("433330", "SOL 미국S&P500", 30_000_000),
      h("161510", "PLUS 고배당주", 20_000_000, "미래에셋 / ISA"),
    ],
    settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS, monthlyNeed: 500_000, incomeStart: "2026-01" },
    today: "2026-10-01",
  });
  assert.equal(view.stage.key, "income");
  assert.equal(view.total, 80_000_000);
  assert.ok(Math.abs(view.need.ratePct - 7.5) < 1e-9);
  const rate = view.warnings.find((w) => w.title.startsWith("필요 인출률"));
  assert.equal(rate?.level, "alert");
  assert.match(rate?.text ?? "", /15%/); // 8% 행: 원금 유지 15%
  assert.ok(view.warnings.some((w) => w.title.startsWith("커버드콜 38%")));
  const tax = view.warnings.find((w) => w.title.startsWith("일반 계좌의 과세 ETF"));
  assert.ok(tax);
  assert.match(tax!.title, /6,000만원/); // ISA의 고배당은 빼고 일반 계좌 두 개만
  assert.ok(view.warnings.some((w) => w.title === "분배금만으로는 생활비가 모자랍니다"));
  assert.equal(view.accounts.length, 2);
  assert.equal(view.accounts.find((a) => a.label === "미래에셋 / ISA")?.taxAdvantaged, true);
});

test("buildIncomeGuideView: 보유가 없으면 옮길 것도 없다", () => {
  const view = buildIncomeGuideView({ holdings: [], settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS }, today: "2026-10-01" });
  assert.equal(view.total, 0);
  assert.equal(view.rebalance.needed, false);
  assert.deepEqual(view.rebalance.moves, []);
});

test("sanitizeIncomeGuideSettings: 범위를 넘는 값은 자르고, 빈 시작 월은 해제한다", () => {
  const cur = { ...DEFAULT_INCOME_GUIDE_SETTINGS, incomeStart: "2035-01" };
  const next = sanitizeIncomeGuideSettings({ monthlyNeed: -5, satelliteCapPct: 90, overseasPct: 30, incomeStart: "" }, cur);
  assert.equal(next.monthlyNeed, 0);
  assert.equal(next.satelliteCapPct, 50);
  assert.equal(next.overseasPct, 30);
  assert.equal(next.incomeStart, undefined);
  assert.equal(sanitizeIncomeGuideSettings({ incomeStart: "2030-13x" }, cur).incomeStart, "2035-01");
});
