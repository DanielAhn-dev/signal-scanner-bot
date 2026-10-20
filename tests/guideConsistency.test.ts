// 같은 입력이면 가이드(view)·할 일(plan)·리포트(report)가 같은 말을 해야 한다.
// 화면마다 따로 짠 규칙이 어긋나 잘못된 안내가 나간 적이 있어(2026-10-19: 예수금 무시, 분배금 방향 반대),
// 설정 조합을 넓게 돌려 서로 모순되는 안내가 없는지 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INCOME_GUIDE_SETTINGS, buildIncomeGuideView, type GuideHolding, type IncomeGuideSettings } from "../src/lib/incomeGuide";
import { buildRebalancePlan } from "../src/lib/rebalancePlan";
import { buildRebalanceReport } from "../src/lib/rebalanceReport";

const H = (code: string, name: string, price: number, quantity: number, avgPrice: number, account = "a"): GuideHolding => ({
  code,
  name,
  price,
  quantity,
  avgPrice,
  accountKey: account,
  accountLabel: account === "a" ? "키움 / 일반" : "미래 / ISA",
});

// 10/19 실계좌와 비슷한 모양: 지수 일부 손실, 커버드콜 비중 큼, 개별주 소액(하나는 크게 수익)
const GENERAL: GuideHolding[] = [
  H("069500", "KODEX 200", 86_820, 111, 101_400),
  H("278530", "KODEX 200TR", 31_455, 56, 31_015),
  H("102110", "TIGER 200", 87_185, 39, 94_312),
  H("498400", "KODEX 200타겟위클리커버드콜", 16_030, 595, 18_741),
  H("0167B0", "SOL 200타겟위클리커버드콜", 9_340, 650, 11_063),
  H("0105E0", "SOL 코리아고배당", 12_125, 610, 12_963),
  H("161510", "PLUS 고배당주", 23_120, 65, 23_572),
  H("329200", "TIGER 리츠부동산인프라", 3_980, 600, 4_065),
  H("005930", "삼성전자", 212_250, 2, 55_570),
  H("005935", "삼성전자우", 167_100, 3, 158_066),
];
const ISA: GuideHolding[] = [H("360750", "TIGER 미국S&P500", 20_000, 200, 18_000, "b")];

type Case = { label: string; holdings: GuideHolding[]; settings: Partial<IncomeGuideSettings> };

function cases(): Case[] {
  const out: Case[] = [];
  for (const withIsa of [false, true])
    for (const hold of [false, true])
      for (const cash of [undefined, 10])
        for (const overseasPct of [0, 50])
          for (const balance of [0, 1_500_000, 15_000_000])
            out.push({
              label: `isa=${withIsa} hold=${hold} cash=${cash ?? "-"} 해외=${overseasPct} 예수금=${balance}`,
              holdings: withIsa ? [...GENERAL, ...ISA] : GENERAL,
              settings: {
                incomeMode: hold ? "hold" : undefined,
                customTargets: { income: hold ? 70 : 40, ...(cash != null ? { cash } : {}) },
                overseasPct,
                cashByAccount: balance > 0 ? { a: balance } : undefined,
              },
            });
  return out;
}

function run(c: Case, accountKey: string) {
  const settings = { ...DEFAULT_INCOME_GUIDE_SETTINGS, ...c.settings } as IncomeGuideSettings;
  const view = buildIncomeGuideView({ holdings: c.holdings, settings, today: "2026-10-19" });
  const plan = buildRebalancePlan({ holdings: view.holdings, total: view.total, groups: view.groups, settings, cashPlan: view.cashPlan });
  const market = { asOf: "2026-10-19", changePct: -1.9, fromHighPct: -21.6 };
  const report = buildRebalanceReport({ view, plan, accountKey, market });
  return { view, plan, report };
}

for (const c of cases()) {
  test(`세 화면 일치: ${c.label}`, () => {
    for (const accountKey of [...new Set(c.holdings.map((h) => h.accountKey))]) {
      const { view, plan, report } = run(c, accountKey);
      assert.ok(plan && report, "보유가 있으면 할 일·리포트가 나온다");
      const where = `[계좌 ${accountKey}]`;

      // 1) 현금을 채우는 중이면 리포트도 분배금·예수금을 지수로 보내지 않는다
      if (plan.cash?.state === "filling") {
        assert.equal(report.buy.fromCash, 0, `${where} 채우는 중인 예수금을 지수 매수에 쓰면 안 된다`);
        for (const s of report.steps.filter((x) => x.includes("분배금(월")))
          assert.match(s, /현금으로 둡니다/, `${where} 분배금 방향이 할 일 화면과 반대: ${s}`);
      }

      // 2) 놀고 있는 예수금: 할 일이 쓸 수 있다고 본 금액을 리포트도 쓴다 (현금 규칙·idleCash 둘 중 하나는 맡는다)
      const bal = Object.entries(c.settings.cashByAccount ?? {}).find(([k]) => k === accountKey)?.[1] ?? 0;
      if (bal > 0) assert.ok(plan.cash || plan.idleCash, `${where} 예수금 ${bal}원이 어느 규칙에도 안 잡힌다`);
      const idle = plan.idleCash?.accounts.find((a) => a.accountKey === accountKey);
      if (idle && report.buy.target) assert.equal(report.buy.fromCash, Math.max(0, idle.spendable), `${where} 예수금 사용액이 할 일과 다르다`);

      // 3) 리포트가 판다고 한 종목은 수익 구간이어야 한다 — 예외는 평단 −15% 이하 개별주를 지수로 옮기기(C69, 종목 카드와 같은 말)
      for (const s of report.sells) assert.ok(s.realizedGain >= 0 || /C69/.test(s.reason), `${where} 손실 종목 매도 안내: ${s.name}`);

      // 4) 가이드가 "지금 옮기는 것이 좋다"고 하면 리포트 마지막 단계도 벗어남을 말한다 (반대도 마찬가지)
      const last = report.steps[report.steps.length - 1];
      if (view.rebalance.needed) assert.doesNotMatch(last, /팔 것은 없습니다/, `${where} 가이드는 리밸런싱 필요, 리포트는 팔 것 없음: ${view.rebalance.reason}`);
      else assert.match(last, /팔 것은 없습니다/, `${where} 가이드는 밴드 안, 리포트는 벗어남`);

      // 5) 인컴 추가매수를 멈춘다고 하면서 리포트가 인컴 종목을 사라고 하지 않는다
      if (report.income.stopReasons.length)
        assert.ok(!report.rows.some((r) => r.group === "income" && r.action === "buy"), `${where} 인컴 매수 멈춤인데 인컴 매수 안내`);
    }
  });
}
