import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INCOME_GUIDE_SETTINGS, buildIncomeGuideView, sanitizeIncomeGuideSettings, type GuideHolding, type IncomeGuideSettings } from "../src/lib/incomeGuide";
import { buildRebalancePlan, holdingYieldPct, pickKeeper, strategyKey } from "../src/lib/rebalancePlan";

// 2026-10-13 사용자 실계좌(일반 계좌 하나)
const H = (code: string, name: string, price: number, quantity: number): GuideHolding => ({
  code,
  name,
  price,
  quantity,
  accountKey: "a",
  accountLabel: "키움 / 일반",
});
const PORTFOLIO: GuideHolding[] = [
  H("069500", "KODEX 200", 102_178, 100),
  H("278530", "KODEX 200TR", 31_015, 56),
  H("0105E0", "SOL 코리아고배당", 12_963, 610),
  H("161510", "PLUS 고배당주", 23_642, 52),
  H("441800", "TIMEFOLIO Korea플러스배당액티브", 30_739, 33),
  H("458730", "TIGER 미국배당다우존스", 14_714, 35),
  H("498400", "KODEX 200타겟위클리커버드콜", 18_820, 550),
  H("0167B0", "SOL 200타겟위클리커버드콜", 11_063, 650),
  H("0219E0", "KODEX 200커버드콜액티브", 8_094, 490),
  H("483290", "KODEX 미국배당다우존스타겟커버드콜", 9_987, 235),
  H("0094M0", "RISE 코리아밸류업위클리고정커버드콜", 17_121, 38),
  H("441640", "KODEX 미국배당커버드콜액티브", 12_252, 14),
  H("329200", "TIGER 리츠부동산인프라", 4_065, 600),
  H("005935", "삼성전자우", 158_066, 3),
  H("005930", "삼성전자", 55_570, 2),
  H("0190C0", "RISE 현대차고정피지컬AI", 8_302, 185),
];

function planFor(settings: Partial<IncomeGuideSettings>, holdings = PORTFOLIO) {
  const s = { ...DEFAULT_INCOME_GUIDE_SETTINGS, customTargets: { income: 65 }, ...settings };
  const view = buildIncomeGuideView({ holdings, settings: s, today: "2026-10-13" });
  return { view, plan: buildRebalancePlan({ holdings: view.holdings, total: view.total, groups: view.groups, settings: s })! };
}

test("strategyKey: 운용사만 다른 같은 상품을 알아본다", () => {
  assert.equal(strategyKey("KODEX 200타겟위클리커버드콜"), strategyKey("SOL 200타겟위클리커버드콜"));
  assert.notEqual(strategyKey("KODEX 200타겟위클리커버드콜"), strategyKey("KODEX 200커버드콜액티브"));
  assert.notEqual(strategyKey("KODEX 200타겟위클리커버드콜"), strategyKey("RISE 코리아밸류업위클리고정커버드콜"));
  // 고배당 ETF는 운용사마다 지수가 다르다
  assert.notEqual(strategyKey("PLUS 고배당주"), strategyKey("SOL 코리아고배당"));
});

test("holdingYieldPct: 타겟 커버드콜은 국내 15%·미국 10%, 그 밖은 바구니 가정", () => {
  assert.equal(holdingYieldPct("covered_call", "KODEX 200타겟위클리커버드콜"), 15);
  assert.equal(holdingYieldPct("covered_call", "KODEX 미국배당다우존스타겟커버드콜"), 10);
  assert.equal(holdingYieldPct("covered_call", "KODEX 200커버드콜액티브"), 8.5);
  assert.equal(holdingYieldPct("dividend", "SOL 코리아고배당"), 4.5);
});

test("pickKeeper: 보수 차이가 있으면 싼 쪽, 비슷하거나 모르면 큰 쪽", () => {
  const a = { code: "AAAAAA", value: 1000 };
  const b = { code: "BBBBBB", value: 500 };
  assert.equal(pickKeeper([a, b]).keeper, a);
  assert.equal(pickKeeper([a, b], { AAAAAA: 0.39, BBBBBB: 0.25 }).keeper, b);
  assert.equal(pickKeeper([a, b], { AAAAAA: 0.39, BBBBBB: 0.25 }).byFee, true);
  // 0.05%p 미만 차이는 비슷한 것으로 보고 보유금액
  assert.equal(pickKeeper([a, b], { AAAAAA: 0.29, BBBBBB: 0.25 }).keeper, a);
  // 한쪽만 알면 보유금액
  assert.equal(pickKeeper([a, b], { BBBBBB: 0.01 }).keeper, a);
});

test("사용자 계좌: 겹치는 커버드콜·소액 인컴을 합치고, 성장 ETF는 건드리지 않는다", () => {
  const { plan } = planFor({});
  const pairs = plan.merges.map((m) => `${m.from.code}->${m.to.code}`).sort();
  assert.deepEqual(pairs, ["0094M0->498400", "0167B0->498400", "161510->0105E0", "441640->483290", "441800->0105E0"].sort());
  // 0219E0(다른 방식, 7%대)과 미국 배당(유일)은 그대로, 성장·위성은 합치기 대상이 아니다
  assert.ok(!plan.merges.some((m) => ["0219E0", "458730", "069500", "278530", "005930"].includes(m.from.code)));
  assert.equal(plan.kinds.before, 16);
  assert.equal(plan.kinds.after, 11);
  // 같은 상품끼리 합치면 인컴은 거의 그대로 (월 ±1만원 안)
  const same = plan.merges.find((m) => m.from.code === "0167B0")!;
  assert.ok(Math.abs(same.monthlyIncomeDelta) < 10_000, String(same.monthlyIncomeDelta));
  // 매수 주수는 매도 대금 안에서
  for (const m of plan.merges) assert.ok(m.to.amount <= m.from.amount);
  assert.match(plan.merges.find((m) => m.from.code === "161510")!.reason, /소액/);
  // 일반 계좌 해외 기초 ETF는 과세 표시
  assert.equal(plan.merges.find((m) => m.from.code === "441640")!.taxedGain, true);
  assert.equal(plan.merges.find((m) => m.from.code === "0167B0")!.taxedGain, false);
});

test("총보수를 넣으면 더 싼 같은 상품을 남긴다", () => {
  const { plan } = planFor({ feePctByCode: { "498400": 0.39, "0167B0": 0.25 } });
  const m = plan.merges.find((x) => x.from.code === "498400");
  assert.ok(m, "보수가 비싼 498400을 0167B0으로 합친다");
  assert.equal(m!.to.code, "0167B0");
  assert.match(m!.reason, /총보수/);
});

test("새 돈은 일반 계좌의 TR형으로, 성장 목표까지 필요한 새 돈과 개월 수", () => {
  const { view, plan } = planFor({ actualMonthlyNet: 550_000, monthlyContribution: 500_000 });
  assert.equal(plan.buyTarget?.code, "278530");
  const g = view.groups.find((x) => x.group === "growth")!;
  const t = g.targetPct / 100;
  assert.equal(plan.growth.needByNewMoney, Math.round((t * view.total - g.value) / (1 - t)));
  // 들어오는 돈 = 적립 50만 + 하한(50만)을 넘는 분배금 5만 + 합치기 변화
  assert.equal(plan.growth.monthlyInflow, Math.round(500_000 + 50_000 + plan.mergeIncomeDelta));
  assert.equal(plan.growth.months, Math.ceil(plan.growth.needByNewMoney / plan.growth.monthlyInflow));
});

test("실제 입금액이 하한과 같으면 팔지 않는다, 여유가 있으면 하한을 지키는 만큼만", () => {
  const tight = planFor({ actualMonthlyNet: 500_000 }).plan;
  assert.equal(tight.trim?.code, "0219E0", "분배율이 가장 낮은 커버드콜이 후보");
  // 합치기로 인컴이 조금이라도 줄면 여유가 없다
  if (tight.mergeIncomeDelta <= 0) assert.equal(tight.trim?.maxShares, 0);

  const roomy = planFor({ actualMonthlyNet: 600_000 }).plan;
  const t = roomy.trim!;
  assert.ok(t.maxShares > 0);
  // 최대치를 팔아도 하한 아래로 내려가지 않는다
  const room = roomy.income.surplus + roomy.mergeIncomeDelta;
  assert.ok((t.maxAmount * t.incomeLossPerMillion) / 1_000_000 <= room + 1);
});

test("인컴이 모자라면 맨 위 문구가 인컴 유지부터 말한다", () => {
  const { plan } = planFor({ actualMonthlyNet: 400_000 });
  assert.equal(plan.income.source, "actual");
  assert.equal(plan.income.surplus, -100_000);
  assert.match(plan.headline, /인컴 유지가 먼저/);
});

test("sanitize: 실제 인컴·적립액·총보수는 선택값이고 보수는 부분 수정", () => {
  let s = sanitizeIncomeGuideSettings({ actualMonthlyNet: 520_000, feePctByCode: { "498400": 0.39 } }, DEFAULT_INCOME_GUIDE_SETTINGS);
  assert.equal(s.actualMonthlyNet, 520_000);
  s = sanitizeIncomeGuideSettings({ feePctByCode: { "0167B0": 0.25 } }, s);
  assert.deepEqual(s.feePctByCode, { "498400": 0.39, "0167B0": 0.25 });
  assert.equal(s.actualMonthlyNet, 520_000, "보내지 않은 값은 유지");
  s = sanitizeIncomeGuideSettings({ actualMonthlyNet: "" as unknown as number, feePctByCode: { "498400": "" as unknown as number } }, s);
  assert.equal(s.actualMonthlyNet, undefined);
  assert.deepEqual(s.feePctByCode, { "0167B0": 0.25 });
});

// 2026-10-13 사용자: 근무 중이라 분배금은 쓰지 않고 지수로, 커버드콜은 팔지 않고 분배금으로 줄여 감, 현금 목표 10%는 분배금으로 천천히
function holdPlan(settings: Partial<IncomeGuideSettings>, pastCashPcts: number[] = []) {
  const s = { ...DEFAULT_INCOME_GUIDE_SETTINGS, incomeMode: "hold" as const, overseasPct: 0, customTargets: { income: 70, cash: 10 }, ...settings };
  const view = buildIncomeGuideView({ holdings: PORTFOLIO, settings: s, today: "2026-10-13", pastCashPcts });
  return { view, plan: buildRebalancePlan({ holdings: view.holdings, total: view.total, groups: view.groups, settings: s, cashPlan: view.cashPlan })! };
}

test("hold: 인컴은 지금 비중이 목표, 현금을 처음 채우는 동안은 지수·커버드콜을 팔지 않는다", () => {
  const { view, plan } = holdPlan({});
  const income = view.groups.find((g) => g.group === "income")!;
  assert.ok(Math.abs(income.actualPct - income.targetPct) < 1e-9);
  assert.equal(view.rebalance.orders.filter((o) => o.side === "sell").length, 0);
  assert.equal(plan.trim, null);
  assert.equal(plan.cash?.state, "filling");
  assert.ok(Math.abs(plan.cash!.amount - view.total * 0.1) < 2);
  assert.doesNotMatch(plan.headline, /인컴 유지가 먼저/);
});

test("hold: 예수금은 현금에 들어가고 주문·분배금 추정·계좌 배치에서는 빠진다", () => {
  const base = holdPlan({}).view;
  const { view, plan } = holdPlan({ cashBalance: 10_000_000 });
  assert.equal(view.total, base.total + 10_000_000);
  assert.equal(view.cashPlan.balance, 10_000_000);
  assert.equal(view.holdingCount, base.holdingCount);
  assert.equal(view.distribution.monthlyNet, base.distribution.monthlyNet);
  assert.ok(view.accounts.every((a) => a.key !== "__cash"));
  assert.ok(view.rebalance.orders.every((o) => o.code !== "CASH"));
  assert.equal(plan.income.estimateNet, holdPlan({}).plan.income.estimateNet);
  // 1천만 / 총액 > 15% → 넘는 몫으로 지수를 산다
  assert.equal(plan.cash?.state, "buy-index");
});

test("hold: 목표에 한 번 닿은 뒤 현금이 밴드 아래로 줄면 지수 일부를 팔아 채운다(규칙형 익절), 밴드 안이면 그대로", () => {
  const low = holdPlan({ cashBalance: 1_000_000 }, [10.2]).plan;
  assert.equal(low.cash?.state, "take-profit");
  assert.equal(low.cash?.sellFrom?.code, "069500");
  const ok = holdPlan({ cashBalance: 6_000_000 }, [10.2]).plan;
  assert.equal(ok.cash?.state, "ok");
  // 지난 기록이 목표에 못 닿았으면 아직 채우는 중
  assert.equal(holdPlan({ cashBalance: 1_000_000 }, [3]).plan.cash?.state, "filling");
});

test("sanitize: 예수금·줄이는 방식은 보낸 키만 바꾸고 빈 값이면 지운다", () => {
  const cur = { ...DEFAULT_INCOME_GUIDE_SETTINGS, cashBalance: 5_000_000, incomeMode: "hold" as const };
  assert.equal(sanitizeIncomeGuideSettings({ monthlyNeed: 400_000 }, cur).cashBalance, 5_000_000);
  assert.equal(sanitizeIncomeGuideSettings({ monthlyNeed: 400_000 }, cur).incomeMode, "hold");
  assert.equal(sanitizeIncomeGuideSettings({ cashBalance: "" as unknown as number }, cur).cashBalance, undefined);
  assert.equal(sanitizeIncomeGuideSettings({ incomeMode: "" as unknown as "hold" }, cur).incomeMode, undefined);
  assert.equal(sanitizeIncomeGuideSettings({ incomeMode: "weird" as unknown as "hold" }, { ...DEFAULT_INCOME_GUIDE_SETTINGS }).incomeMode, undefined);
});

test("hold가 아니면 기존 동작 그대로 (현금 단계 없음)", () => {
  const { plan } = planFor({});
  assert.equal(plan.hold, false);
  assert.equal(plan.cash, null);
});

test("압축: 목표 종목 수가 없으면 기존 동작 그대로(compress 없음)", () => {
  const { plan } = planFor({});
  assert.equal(plan.compress, null);
});

test("압축: 역할(지역×바구니)별 대표 하나로 합치고 같은 계좌 안에서만 옮긴다", () => {
  const base = planFor({});
  const { plan } = planFor({ incomeKindsTarget: 5 });
  const c = plan.compress!;
  assert.equal(c.before, 11);
  assert.equal(c.after, 5);
  assert.equal(c.reached, true);
  // 앞 단계에서 이미 SOL·RISE를 받는 498400이 한국 커버드콜 대표, 0219E0은 거기로
  const m = plan.merges.find((x) => x.from.code === "0219E0")!;
  assert.equal(m.to.code, "498400");
  assert.match(m.reason, /역할별 대표/);
  // 한 종목을 두 번 팔지 않는다 (받는 쪽이 동시에 파는 쪽이 되지 않음)
  const froms = new Set(plan.merges.map((x) => x.from.code));
  for (const x of plan.merges) assert.ok(!froms.has(x.to.code), `${x.to.code}는 받는 쪽이면서 파는 쪽`);
  // 인컴은 하한(50만원) 아래로 내려가지 않는다 — 분배율 높은 쪽으로 모으므로 줄지 않는다
  assert.ok(c.incomeAfter >= Math.min(c.floor, plan.income.monthlyNet));
  assert.ok(plan.mergeIncomeDelta >= base.plan.mergeIncomeDelta);
  assert.ok(c.roles.some((r) => r.label === "한국 커버드콜" && r.merged.length > 0));
});

test("압축: 월 인컴 하한을 못 지키는 합치기는 막고 이유를 남긴다", () => {
  // 실제 월 입금액이 하한과 같고, 직접 고른 대표가 분배율이 낮은 쪽이면 합치면 인컴이 줄어든다
  const { plan } = planFor({ incomeKindsTarget: 4, actualMonthlyNet: 500_000, roleKeepers: { "kr|dividend": "161510" } });
  const c = plan.compress!;
  assert.ok(c.incomeAfter >= Math.min(c.floor, 500_000) - 1);
  for (const b of c.blocked) assert.ok(b.reason.length > 0);
});

test("압축: 같은 계좌에 대표 종목이 없으면 계좌를 바꿔 합치지 않는다", () => {
  const holdings = [
    ...PORTFOLIO,
    { ...H("251340", "KODEX 코스닥150", 12_000, 10), accountKey: "b", accountLabel: "키움 / ISA" },
    { ...H("0219E0", "KODEX 200커버드콜액티브", 8_094, 100), accountKey: "b", accountLabel: "키움 / ISA" },
  ];
  const { plan } = planFor({ incomeKindsTarget: 4 }, holdings);
  // ISA 계좌의 0219E0은 그 계좌에 498400이 없어 합치지 못한다 → 다른 계좌 것도 같은 종목이라 종목은 남는다
  for (const x of plan.merges) {
    const from = holdings.find((h) => h.code === x.from.code && h.accountLabel === x.from.accountLabel)!;
    assert.equal(from.accountLabel, x.to.accountLabel);
  }
});

test("sanitize: 인컴 목표 종목 수는 1~20 정수, 역할별 대표는 보낸 역할만 고친다", () => {
  const cur = DEFAULT_INCOME_GUIDE_SETTINGS;
  const a = sanitizeIncomeGuideSettings({ incomeKindsTarget: 6, roleKeepers: { "kr|covered_call": "498400" } }, cur);
  assert.equal(a.incomeKindsTarget, 6);
  assert.deepEqual(a.roleKeepers, { "kr|covered_call": "498400" });
  const b = sanitizeIncomeGuideSettings({ roleKeepers: { "us|covered_call": "483290" } }, a);
  assert.deepEqual(b.roleKeepers, { "kr|covered_call": "498400", "us|covered_call": "483290" });
  const c = sanitizeIncomeGuideSettings({ roleKeepers: { "kr|covered_call": "" } }, b);
  assert.deepEqual(c.roleKeepers, { "us|covered_call": "483290" });
  assert.equal(sanitizeIncomeGuideSettings({ incomeKindsTarget: "" as unknown as number }, b).incomeKindsTarget, undefined);
  assert.equal(sanitizeIncomeGuideSettings({ incomeKindsTarget: 99 }, b).incomeKindsTarget, undefined);
  assert.equal(sanitizeIncomeGuideSettings({}, b).incomeKindsTarget, 6);
  assert.equal(sanitizeIncomeGuideSettings({}, a).incomeKindsTarget, 6);
});
