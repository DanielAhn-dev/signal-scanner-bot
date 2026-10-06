import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INCOME_GUIDE_SETTINGS,
  buildIncomeGuideView,
  buildNpsReference,
  NPS_REFERENCE,
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

test("buildIncomeGuideView: 종목별 주문안 — 넘친 종목은 주 단위로 팔고 확정 손익을 보여 주며, 대금으로 모자란 종목을 산다", () => {
  const view = buildIncomeGuideView({
    holdings: [
      { code: "069500", name: "KODEX 200", quantity: 100, price: 50_000, avgPrice: 40_000, accountKey: "a", accountLabel: "키움 / 일반" },
      { code: "433330", name: "SOL 미국S&P500", quantity: 100, price: 20_000, accountKey: "b", accountLabel: "미래 / ISA" },
      { code: "161510", name: "PLUS 고배당주", quantity: 100, price: 10_000, accountKey: "b", accountLabel: "미래 / ISA" },
      { code: "475720", name: "RISE 200위클리커버드콜", quantity: 100, price: 10_000, accountKey: "a", accountLabel: "키움 / 일반" },
    ],
    settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS },
    today: "2026-10-01",
  });
  // 총 900만: 목표 인컴 10%=90만(현재 200만 → 110만 매도), 성장 810만 → 국내·해외 405만씩
  const sells = view.rebalance.orders.filter((o) => o.side === "sell");
  const buys = view.rebalance.orders.filter((o) => o.side === "buy");
  const k200 = sells.find((o) => o.code === "069500");
  assert.equal(k200?.shares, 19); // 500만 − 405만 = 95만 → 50,000원 × 19주
  assert.equal(k200?.realizedGain, 19 * 10_000);
  assert.ok(sells.some((o) => o.code === "161510" || o.code === "475720"));
  // 커버드콜은 더 사지 않고, 해외 지수는 가진 종목(SOL)에 산다
  assert.ok(!buys.some((o) => o.code === "475720"));
  assert.equal(buys.find((o) => o.code === "433330")?.shares, 102); // 405만 − 200만 = 205만 → 20,000원 × 102주
  assert.equal(view.rebalance.realizedGainTotal, 190_000);
});

test("buildIncomeGuideView: 인컴 바구니를 줄일 땐 금액이 더 작아도 커버드콜부터 판다 (2026-10-01 다중시작점 검증 — 재투자 기준 고배당은 지수를 이기고 커버드콜은 진다)", () => {
  // 총 610만(인컴 600만 + 성장 10만), 목표 인컴 85% → 줄일 금액 81.5만 — 커버드콜(100만) 하나로 충분해서
  // 고배당(161510, 500만으로 더 크다)을 안 건드리고도 채워지는지로 우선순위를 가른다.
  const view = buildIncomeGuideView({
    holdings: [
      { code: "161510", name: "PLUS 고배당주", quantity: 100, price: 50_000, accountKey: "a", accountLabel: "키움 / 일반" },
      { code: "475720", name: "RISE 200위클리커버드콜", quantity: 100, price: 10_000, accountKey: "a", accountLabel: "키움 / 일반" },
      { code: "069500", name: "KODEX 200", quantity: 10, price: 10_000, accountKey: "a", accountLabel: "키움 / 일반" },
    ],
    settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS, customTargets: { income: 85 } },
    today: "2026-10-01",
  });
  const sells = view.rebalance.orders.filter((o) => o.side === "sell");
  const cc = sells.find((o) => o.code === "475720");
  const div = sells.find((o) => o.code === "161510");
  assert.ok(cc, "커버드콜을 팔아야 한다");
  assert.ok(!div, "커버드콜만으로 채워지면 금액이 더 큰 고배당은 건드리지 않는다");
});

test("buildIncomeGuideView: 같은 바구니 안에서는 손실 중인 종목보다 이익·본전인 종목을 먼저 판다 (2026-10-01 사용자 — 인컴은 계속 들어오니 굳이 손실 보며 팔고 싶지 않다)", () => {
  const view = buildIncomeGuideView({
    holdings: [
      // 둘 다 커버드콜, 손실 중인 쪽(475720)이 금액은 더 크다 — 그래도 이익 중인 489030을 먼저 판다
      { code: "475720", name: "RISE 200위클리커버드콜", quantity: 100, price: 9_000, avgPrice: 10_000, accountKey: "a", accountLabel: "키움 / 일반" },
      { code: "489030", name: "PLUS 고배당주위클리커버드콜", quantity: 50, price: 11_000, avgPrice: 10_000, accountKey: "a", accountLabel: "키움 / 일반" },
      { code: "069500", name: "KODEX 200", quantity: 10, price: 10_000, accountKey: "a", accountLabel: "키움 / 일반" },
    ],
    // 총 155만(커버드콜 140만 + 성장 10만), 목표 인컴 90% → 줄일 금액 15.5만 — 이익 중인 489030(55만)만으로 충분
    settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS, customTargets: { income: 90 } },
    today: "2026-10-01",
  });
  const sells = view.rebalance.orders.filter((o) => o.side === "sell");
  const loss = sells.find((o) => o.code === "475720");
  const gain = sells.find((o) => o.code === "489030");
  assert.ok(gain, "이익 중인 종목을 팔아야 한다");
  assert.ok(!loss, "손실 중인 종목은 이익 중인 종목으로 채워지면 건드리지 않는다");
});

test("buildIncomeGuideView: 새로 넣을 돈은 모자란 바구니부터 채우고, 가진 상품이 없으면 새 상품 금액으로 남긴다", () => {
  const view = buildIncomeGuideView({
    holdings: [h("069500", "KODEX 200", 9_000_000)],
    settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS },
    today: "2026-10-01",
    contribution: 1_000_000,
  });
  // 새 총액 1,000만: 인컴 목표 100만, 해외 목표 450만 → 모자란 합 550만 > 넣는 돈 100만 → 비례 배분
  const c = view.contribution!;
  assert.equal(c.amount, 1_000_000);
  const alloc = Object.fromEntries(c.allocations.map((a) => [a.group, a.amount]));
  assert.equal(alloc.income, Math.round((1_000_000 * 1_000_000) / 5_500_000));
  assert.equal(alloc.growth, Math.round((1_000_000 * 4_500_000) / 5_500_000));
  assert.ok(c.unfilled.some((u) => u.group === "income"));
  assert.ok(c.unfilled.some((u) => u.bucket === "global_index"));
  assert.equal(c.stillOutOfBand, true);
});

test("buildIncomeGuideView: 직접 정한 목표 비중이 단계 기본값보다 우선한다", () => {
  const view = buildIncomeGuideView({
    holdings: [h("069500", "KODEX 200", 6_000_000), h("161510", "PLUS 고배당주", 4_000_000)],
    settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS, customTargets: { income: 40 } },
    today: "2026-10-01",
  });
  assert.equal(view.targetSource, "custom");
  const g = Object.fromEntries(view.groups.map((r) => [r.group, r]));
  assert.equal(g.income.targetPct, 40);
  assert.equal(g.growth.targetPct, 60);
  assert.equal(g.income.diffAmount, 0);
});

test("buildIncomeGuideView: 일반 계좌 분배금만 금융소득 상한에 세고, 커버드콜이 상한을 빨리 채운다고 알린다", () => {
  const view = buildIncomeGuideView({
    holdings: [
      h("475720", "RISE 200위클리커버드콜", 100_000_000), // 일반: 8.5% → 850만
      h("161510", "PLUS 고배당주", 40_000_000), // 일반: 4.5% → 180만
      h("402970", "ACE 미국배당다우존스", 50_000_000, "미래에셋 / ISA"), // 절세: 4.5% → 225만
    ],
    settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS },
    today: "2026-10-01",
  });
  assert.equal(view.distributions.taxableAnnual, 10_300_000);
  assert.equal(view.distributions.shelteredAnnual, 2_250_000);
  assert.equal(view.distributions.headroom, -300_000);
  assert.equal(view.distributions.headroomAsDividendCapital, 0);
  assert.equal(view.distributions.taxableFromCoveredCall, 8_500_000);
  assert.ok(view.warnings.some((w) => w.level === "warn" && w.title.includes("상한 1,000만원 초과")));
  assert.ok(view.warnings.some((w) => w.title.startsWith("일반 계좌 커버드콜 분배금 연 850만원")));
  // 상한을 3천만으로 올리면 초과 경고는 사라지고 여유를 고배당 금액으로 환산한다
  const roomy = buildIncomeGuideView({
    holdings: [h("161510", "PLUS 고배당주", 40_000_000)],
    settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS, financialIncomeCap: 3_600_000 },
    today: "2026-10-01",
  });
  assert.equal(roomy.distributions.headroom, 1_800_000);
  assert.equal(roomy.distributions.headroomAsDividendCapital, 40_000_000);
});

test("toHistoryEntry·appendHistory: 같은 날 같은 비중은 덮어쓰고 날짜순으로 쌓는다", async () => {
  const { toHistoryEntry, appendHistory } = await import("../src/lib/incomeGuide");
  const view = buildIncomeGuideView({ holdings: [h("069500", "KODEX 200", 1_000_000)], settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS }, today: "2026-10-01" });
  const e1 = toHistoryEntry(view, "첫 점검");
  let hist = appendHistory([{ date: "2027-01-02", total: 1, groups: [] }], e1);
  hist = appendHistory(hist, { ...e1, note: "다시" });
  assert.deepEqual(hist.map((x) => x.date), ["2026-10-01", "2027-01-02"]);
  assert.equal(hist[0].note, "다시");
  assert.equal(hist[0].groups.find((g) => g.group === "growth")?.actualPct, 100);
});

test("appendHistory: 같은 날이라도 비중이 바뀌면 옮기기 전·후를 둘 다 남긴다", async () => {
  const { toHistoryEntry, appendHistory } = await import("../src/lib/incomeGuide");
  const settings = { ...DEFAULT_INCOME_GUIDE_SETTINGS };
  const before = toHistoryEntry(buildIncomeGuideView({ holdings: [h("069500", "KODEX 200", 5_000_000), h("005930", "삼성전자", 5_000_000)], settings, today: "2026-10-06" }));
  const after = toHistoryEntry(buildIncomeGuideView({ holdings: [h("069500", "KODEX 200", 9_000_000), h("005930", "삼성전자", 1_000_000)], settings, today: "2026-10-06" }));
  const hist = appendHistory(appendHistory([], before), after);
  assert.equal(hist.length, 2);
});

test("compareWithHistory: 직전의 다른 상태와 비교해 목표와의 거리가 줄었는지 알려 준다", async () => {
  const { toHistoryEntry, appendHistory, compareWithHistory, distanceFromTarget } = await import("../src/lib/incomeGuide");
  const settings = { ...DEFAULT_INCOME_GUIDE_SETTINGS };
  const beforeView = buildIncomeGuideView({ holdings: [h("069500", "KODEX 200", 5_000_000), h("005930", "삼성전자", 5_000_000)], settings, today: "2026-09-01" });
  const nowView = buildIncomeGuideView({ holdings: [h("069500", "KODEX 200", 9_000_000), h("005930", "삼성전자", 1_000_000)], settings, today: "2026-10-06" });
  assert.equal(compareWithHistory(nowView, []), null);
  // 방금 누른 지금 기록은 건너뛰고 그 앞 기록과 비교한다
  const hist = appendHistory(appendHistory([], toHistoryEntry(beforeView, "옮기기 전")), toHistoryEntry(nowView));
  const c = compareWithHistory(nowView, hist)!;
  assert.equal(c.base.date, "2026-09-01");
  assert.equal(c.base.note, "옮기기 전");
  assert.equal(c.verdict, "closer");
  assert.ok(c.base.distancePp > c.now.distancePp);
  assert.equal(c.groups.find((g) => g.group === "satellite")?.beforePct, 50);
  assert.equal(distanceFromTarget([{ actualPct: 60, targetPct: 80 }, { actualPct: 40, targetPct: 20 }]), 20);
});

test("healthTrend: 처음 기록·한 달 전 기록·지금을 돌려준다", async () => {
  const { toHistoryEntry, healthTrend } = await import("../src/lib/incomeGuide");
  const settings = { ...DEFAULT_INCOME_GUIDE_SETTINGS };
  const v = (today: string, sat: number) =>
    buildIncomeGuideView({ holdings: [h("069500", "KODEX 200", 10_000_000 - sat), h("005930", "삼성전자", sat)], settings, today });
  const hist = [toHistoryEntry(v("2026-07-01", 4_000_000)), toHistoryEntry(v("2026-09-01", 2_000_000)), toHistoryEntry(v("2026-09-30", 1_500_000))];
  const t = healthTrend(v("2026-10-06", 1_000_000), hist)!;
  assert.equal(t.first?.date, "2026-07-01");
  assert.equal(t.monthAgo?.date, "2026-09-01");
  assert.equal(t.now.satellitePct, 10);
  assert.equal(healthTrend(v("2026-10-06", 1_000_000), [hist[0]])?.monthAgo, null);
});

test("sanitizeIncomeGuideSettings: 목표 비중 빈 칸은 단계 기본값으로 되돌리고, 합이 100을 넘지 않게 자른다", () => {
  const cur = { ...DEFAULT_INCOME_GUIDE_SETTINGS, customTargets: { income: 30, cash: 10 } };
  assert.deepEqual(sanitizeIncomeGuideSettings({ customTargets: { income: "" as unknown as number } }, cur).customTargets, { cash: 10 });
  assert.equal(sanitizeIncomeGuideSettings({ customTargets: { income: "", cash: "" } as never }, cur).customTargets, undefined);
  assert.deepEqual(sanitizeIncomeGuideSettings({ customTargets: { income: 80, cash: 40 } }, cur).customTargets, { income: 80, cash: 20 });
  assert.deepEqual(sanitizeIncomeGuideSettings({ monthlyNeed: 1 }, cur).customTargets, { income: 30, cash: 10 });
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

test("나이대: 설정 없으면 기존 단계 목표 그대로, 있으면 모으기 단계 현금성에 하한을 둔다", () => {
  const base = { ...DEFAULT_INCOME_GUIDE_SETTINGS };
  const today = "2026-10-01";
  const none = resolveStageTargets({ settings: base, total: 100_000_000, today });
  assert.equal(none.cashPct, 0);
  const forty = resolveStageTargets({ settings: { ...base, ageBand: "40s" }, total: 100_000_000, today });
  assert.equal(forty.cashPct, 35);
  assert.equal(forty.incomePct, none.incomePct);
  // 인컴 단계는 생활비 기준 비중이라 나이대 하한을 얹지 않는다
  const incomeNone = resolveStageTargets({ settings: { ...base, incomeStart: "2026-01" }, total: 100_000_000, today });
  const incomeAged = resolveStageTargets({ settings: { ...base, incomeStart: "2026-01", ageBand: "60s" }, total: 100_000_000, today });
  assert.equal(incomeAged.cashPct, incomeNone.cashPct);
});

test("나이대: 인컴 + 현금성이 100%를 넘지 않게 하한을 줄이고, 잘못된 값은 무시한다", () => {
  const today = "2026-10-01";
  const t = resolveStageTargets({
    settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS, incomeStart: "2027-06", ageBand: "60s", monthlyNeed: 3_000_000 },
    total: 100_000_000,
    today,
  });
  assert.ok(t.incomePct + t.cashPct <= 100.0001);
  const cur = { ...DEFAULT_INCOME_GUIDE_SETTINGS, ageBand: "30s" as const };
  assert.equal(sanitizeIncomeGuideSettings({ ageBand: "70s" as never }, cur).ageBand, "30s");
  assert.equal(sanitizeIncomeGuideSettings({ ageBand: "" as never }, cur).ageBand, undefined);
  assert.equal(sanitizeIncomeGuideSettings({ ageBand: "50s" }, cur).ageBand, "50s");
});

test("withMonthlyEntry: 이번 달 기록이 없을 때만 자동 기록(수량 포함)을 더한다", async () => {
  const { withMonthlyEntry } = await import("../src/lib/incomeGuide");
  const settings = { ...DEFAULT_INCOME_GUIDE_SETTINGS };
  const holdings = [h("069500", "KODEX 200", 1_000_000), h("069500", "KODEX 200", 1_000_000)];
  const view = buildIncomeGuideView({ holdings, settings, today: "2026-10-06" });
  const next = withMonthlyEntry([{ date: "2026-09-01", total: 1, groups: [] }], view, holdings)!;
  assert.equal(next.length, 2);
  assert.equal(next[1].auto, true);
  assert.deepEqual(next[1].holdings, [{ code: "069500", name: "KODEX 200", quantity: holdings[0].quantity * 2 }]);
  assert.equal(withMonthlyEntry(next, view, holdings), null);
});

test("splitChange: 그때 수량을 지금 가격으로 다시 계산해 시장 몫과 내 매매 몫을 나눈다", async () => {
  const { toHistoryEntry, splitChange, distanceFromTarget } = await import("../src/lib/incomeGuide");
  const settings = { ...DEFAULT_INCOME_GUIDE_SETTINGS };
  const g = (code: string, name: string, quantity: number, price: number) => ({ code, name, quantity, price, accountKey: "a", accountLabel: "a" });
  // 그때: 지수 90만 + 개별주 10만 (위성 10%)
  const then = [g("069500", "KODEX 200", 90, 10_000), g("005930", "삼성전자", 10, 10_000)];
  const base = toHistoryEntry(buildIncomeGuideView({ holdings: then, settings, today: "2026-09-01" }), undefined, { holdings: then });
  // 지금 가격: 개별주가 4배 → 가만히 뒀다면 위성 약 31%. 실제로는 개별주를 팔아 지수로 옮겼다
  const price: Record<string, number> = { "069500": 10_000, "005930": 40_000 };
  const nowView = buildIncomeGuideView({ holdings: [g("069500", "KODEX 200", 125, 10_000), g("005930", "삼성전자", 1, 40_000)], settings, today: "2026-10-06" });
  const s = splitChange(base, distanceFromTarget(nowView.groups), { settings, today: "2026-10-06", priceOf: (c) => price[c] })!;
  assert.ok(s.marketPp > 0, "시장 몫은 멀어짐");
  assert.ok(s.minePp < 0, "내 매매 몫은 가까워짐");
  assert.match(s.text, /시장 움직임으로 .*멀어짐, 내 매매·입금으로 .*가까워짐/);
  // 가격을 모르는 종목이 있으면 나누지 않는다
  assert.equal(splitChange(base, 0, { settings, today: "2026-10-06", priceOf: () => null }), null);
  assert.equal(splitChange({ ...base, holdings: undefined }, 0, { settings, today: "2026-10-06", priceOf: (c) => price[c] }), null);
});

test("국민연금 참고 비교: 주식·채권·대체로 묶고 목표 합계는 100", () => {
  assert.equal(NPS_REFERENCE.equityPct + NPS_REFERENCE.bondPct + NPS_REFERENCE.altPct, 100);
  const rows = buildNpsReference(new Map([["kr_index", 600], ["bond_cash", 300], ["reit_infra", 100]]), 1000)!;
  assert.equal(rows[0].actualPct, 60);
  assert.equal(rows[1].actualPct, 30);
  assert.equal(rows[2].actualPct, 10);
  assert.ok(Math.abs(rows[0].diffPp - 4.5) < 1e-9);
  assert.equal(buildNpsReference(new Map(), 0), null);
});
