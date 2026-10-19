import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INCOME_GUIDE_SETTINGS, buildIncomeGuideView, type GuideHolding, type IncomeGuideSettings } from "../src/lib/incomeGuide";
import { buildRebalancePlan } from "../src/lib/rebalancePlan";
import { buildRebalanceReport, estimateSellCost, pickIndexProduct, sameIndexKey } from "../src/lib/rebalanceReport";
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

test("실행 순서 문구는 상황일 때만: 1주·개별주면 '나눠 팔기'·'분배락일' 없이 소액 안내", () => {
  const r = reportFor([H("278530", "KODEX 200TR", 60_000, 300, 58_000), H("005930", "삼성전자", 55_000, 2, 44_000)]);
  const sellStep = r.steps.find((s) => s.startsWith("수익 구간 종목부터"))!;
  assert.ok(!sellStep.includes("나눠"), sellStep);
  assert.ok(!sellStep.includes("분배락일"), sellStep);
  assert.match(sellStep, /금액이 55,000원으로 작아/);
  assert.ok(r.steps.some((s) => s.includes("1주 값")), "대금이 1주 값보다 작으면 '0주' 대신 다음 분배금과 합친다고 쓴다");
  assert.ok(r.steps.at(-1)!.includes("인컴 (분배형) 0%(목표 65%)"), r.steps.at(-1));
});

test("분배형 종목을 팔 때만 분배락일 안내", () => {
  const r = reportFor([
    H("069500", "KODEX 200", 50_000, 50, 45_000),
    H("498400", "KODEX 200타겟위클리커버드콜", 18_000, 500, 17_000),
    H("0167B0", "SOL 200타겟위클리커버드콜", 11_000, 100, 10_500),
  ]);
  const sellStep = r.steps.find((s) => s.startsWith("수익 구간 종목부터"))!;
  assert.match(sellStep, /SOL 200타겟위클리커버드콜은 분배금이 나오는 종목/);
  assert.match(sellStep, /나눠 팔아도/);
});

test("커버드콜이 없는 계좌에는 커버드콜 문단을 넣지 않는다", () => {
  const r = reportFor([H("069500", "KODEX 200", 50_000, 50, 45_000), H("161510", "PLUS 고배당주", 20_000, 100, 22_000)]);
  assert.ok(!r.income.lines.some((s) => s.startsWith("커버드콜은")));
  assert.ok(r.income.lines.some((s) => s.includes("C48")));
});

test("sameIndexKey: 운용사만 다른 같은 상품", () => {
  assert.equal(sameIndexKey("KODEX 200TR"), sameIndexKey("TIGER 200TR"));
  assert.notEqual(sameIndexKey("KODEX 200TR"), sameIndexKey("KODEX 200"));
  assert.equal(sameIndexKey("KODEX"), null);
});

test("같은 지수 상품 총보수가 0.05%p 이상 낮으면 새 돈은 그쪽으로, 기존 보유는 수익 구간이면 옮긴다", () => {
  const s = { ...DEFAULT_INCOME_GUIDE_SETTINGS, customTargets: { income: 65 } };
  const holdings = [H("278530", "KODEX 200TR", 15_000, 100, 14_000), H("005930", "삼성전자", 60_000, 10, 48_000)];
  const view = buildIncomeGuideView({ holdings, settings: s, today: "2026-10-15" });
  const plan = buildRebalancePlan({ holdings: view.holdings, total: view.total, groups: view.groups, settings: s, cashPlan: view.cashPlan });
  const etf = new Map([["278530", { yieldTtm: 0, fee: 0.09 }]]);
  const r = buildRebalanceReport({ view, plan, accountKey: "a", etf, feeAlternatives: [{ code: "999999", name: "TIGER 200TR", price: 12_000, fee: 0.02 }] })!;
  assert.equal(r.buy.target?.code, "999999");
  assert.equal(r.sells[0].to?.code, "999999", "매도 대금도 싼 쪽으로");
  assert.match(r.feeSwitch!.text, /1천만원당 연 약 7,000원/);
  assert.equal(r.rows.find((x) => x.code === "278530")!.action, "sell", "수익 구간이라 싼 쪽으로 옮긴다");
  assert.equal(r.feeCompare.length, 2);
  // 차이가 기준보다 작으면 바꾸지 않는다
  const same = buildRebalanceReport({ view, plan, accountKey: "a", etf, feeAlternatives: [{ code: "999999", name: "TIGER 200TR", price: 12_000, fee: 0.045 }] })!;
  assert.equal(same.rows.find((x) => x.code === "278530")!.action, "buy");
  assert.equal(same.buy.target?.code, "278530");
  assert.equal(same.feeSwitch, null);
});

test("pickIndexProduct: 보수가 같으면 1년 수익률·시가총액으로, 작은 상품·큰 괴리율은 제외", () => {
  const c = (code: string, name: string, fee: number, capEok: number | null, ret: number | null, dev: number | null = 0.05) => ({
    code, name, price: 10_000, fee, marketCap: capEok == null ? null : capEok * 1e8, return1y: ret, deviation: dev,
  });
  const pool = [
    c("A", "ACE 200TR", 0.01, 3_000, 92.1),
    c("P", "PLUS 200TR", 0.01, 8_000, 92.2),
    c("K", "KIWOOM 200TR", 0.01, 500, 92.3), // 작음
    c("S", "SOL 200TR", 0.01, 9_000, 91.7), // 수익률 0.6%p 낮음
    c("R", "RISE 200TR", 0.012, 12_000, 92.2, 1.5), // 괴리율 큼
    c("X", "TIGER 200TR", 0.09, 61_000, 92.0),
  ];
  const pick = pickIndexProduct(pool, "X")!;
  assert.equal(pick.chosen.code, "P", "ACE(첫 번째)가 아니라 조건을 모두 통과한 것 중 가장 큰 PLUS");
  assert.match(pick.notes.get("K")!, /시가총액 500억/);
  assert.match(pick.notes.get("S")!, /1년 수익률이 0.50%p 낮음/);
  assert.match(pick.notes.get("R")!, /괴리율/);
  assert.match(pick.notes.get("X")!, /총보수가 최저/);
  assert.equal(pick.notes.get("A"), "조건은 같고 시가총액이 더 작음");
  // 가진 상품이 최선 묶음이면 바꾸지 않는다
  assert.equal(pickIndexProduct(pool, "A")!.chosen.code, "A");
  // 가진 상품 보수가 최저보다 0.05%p 미만 비싸면 그대로(KODEX 200TR 0.05% vs 0.01%)
  const withKodex = [...pool, c("D", "KODEX 200TR", 0.05, 61_000, 92.0)];
  assert.equal(pickIndexProduct(withKodex, "D")!.chosen.code, "D");
  // 가진 게 여럿이면 앞(큰 것)부터 — 비싼 X는 못 남지만 이미 옮겨 산 S는 수익률이 낮아도 그대로(날마다 바뀌지 않게)
  assert.equal(pickIndexProduct(pool, ["X", "S"])!.chosen.code, "S");
});

test("같은 지수 다른 보유 상품: 보수가 0.05%p 이상 비싸면 수익 구간에 옮기고, 손실이면 평단 회복 시, 차이 작으면 그대로", () => {
  const s = { ...DEFAULT_INCOME_GUIDE_SETTINGS, customTargets: { income: 65 } };
  const mk = (kodexAvg: number) => {
    const holdings = [
      H("278530", "KODEX 200TR", 15_000, 100, 14_000),
      H("069500", "KODEX 200", 50_000, 30, kodexAvg),
      H("102110", "TIGER 200", 50_000, 10, 45_000),
      H("498400", "KODEX 200타겟위클리커버드콜", 10_000, 400, 9_000),
    ];
    const view = buildIncomeGuideView({ holdings, settings: s, today: "2026-10-15" });
    const plan = buildRebalancePlan({ holdings: view.holdings, total: view.total, groups: view.groups, settings: s, cashPlan: view.cashPlan });
    const etf = new Map([
      ["278530", { yieldTtm: 0, fee: 0.05 }],
      ["069500", { yieldTtm: 1.5, fee: 0.15 }],
      ["102110", { yieldTtm: 1.5, fee: 0.05 }],
    ]);
    // 실제 상황: 0.01%짜리 다른 운용사 TR이 있어도 차이 0.04%p라 가진 KODEX 200TR을 계속 산다
    return buildRebalanceReport({ view, plan, accountKey: "a", etf, feeAlternatives: [{ code: "294400", name: "KIWOOM 200TR", price: 20_000, fee: 0.01 }] })!;
  };
  const up = mk(45_000);
  assert.equal(up.buy.target?.code, "278530");
  assert.equal(up.feeSwitch, null);
  const move = up.sells.find((x) => x.code === "069500")!;
  assert.equal(move.to?.code, "278530");
  assert.equal(move.shares, 30);
  assert.match(move.reason, /0.15% → 0.05%/);
  assert.match(up.rows.find((x) => x.code === "102110")!.actionText, /그대로 둡니다 — KODEX 200TR와 같은 지수/);
  assert.ok(!up.sells.some((x) => x.code === "498400"), "커버드콜은 지수 옮기기 대상이 아니다");
  const down = mk(60_000);
  assert.ok(!down.sells.some((x) => x.code === "069500"));
  assert.equal(down.conditionals.find((x) => x.code === "069500")!.triggerPrice, 60_000);
  assert.equal(down.rows.find((x) => x.code === "069500")!.action, "sell-later");
});

test("인컴 종목 압축: 목표 종목 수가 없으면 없고, 있으면 이 계좌의 이동과 표가 리포트에 들어간다", () => {
  const holdings = [
    H("069500", "KODEX 200", 100_000, 20, 90_000),
    H("498400", "KODEX 200타겟위클리커버드콜", 18_820, 500, 15_000),
    H("0219E0", "KODEX 200커버드콜액티브", 8_094, 400, 7_000),
    H("0105E0", "SOL 코리아고배당", 12_963, 300, 12_000),
    H("441800", "TIMEFOLIO Korea플러스배당액티브", 30_739, 40, 25_000),
  ];
  assert.equal(reportFor(holdings).compress, null);
  const r = reportFor(holdings, { incomeKindsTarget: 2 });
  const c = r.compress!;
  assert.equal(c.target, 2);
  assert.ok(c.after <= c.before);
  assert.ok(c.moves.length > 0);
  // 수익 구간이라 지금 옮기고, 매도 표에도 같은 종목이 있다
  for (const m of c.moves) assert.ok(r.sells.some((s) => s.code === m.from.code) || r.conditionals.some((x) => x.code === m.from.code));
  const html = renderRebalanceReportHtml(r, "2026-10-15 10:00");
  assert.match(html, /인컴 종목 압축/);
  assert.match(html, /역할/);
  assert.ok(r.steps.some((s) => s.includes("인컴 종목 압축")));
});

test("예수금: 그 계좌 예수금만 그 계좌 리포트에 — 판 대금이 지수로 가면 합쳐서 한 번에 산다", () => {
  const holdings = [
    H("278530", "KODEX 200TR", 15_000, 100, 14_000),
    H("498400", "KODEX 200타겟위클리커버드콜", 18_000, 100, 17_000),
    H("360750", "TIGER 미국S&P500", 20_000, 10, 19_000, "b"),
  ];
  const r = reportFor(holdings, { cashByAccount: { a: 1_000_000 } });
  const step = r.steps.find((s) => s.includes("예수금"));
  assert.ok(step, "예수금 단계가 있다");
  assert.match(step!, /KODEX 200TR 약 66주/);
  assert.equal(r.buy.fromCash, 1_000_000);
  const other = reportFor(holdings, { cashByAccount: { a: 1_000_000 } }, "b");
  assert.ok(!other.steps.some((s) => s.includes("예수금")), "다른 계좌 예수금은 넣지 않는다");

  // 개별주 +25% 절반을 TR로 팔 때 — 판 대금과 예수금을 합친 수량
  const withSell = reportFor([H("278530", "KODEX 200TR", 15_000, 100, 14_000), H("005930", "삼성전자", 60_000, 10, 48_000)], { cashByAccount: { a: 100_000 } });
  const buyStep = withSell.steps.find((s) => s.startsWith("판 날"))!;
  assert.match(buyStep, /판 대금 .* \+ 예수금 10만원/);
  assert.equal(withSell.buy.shares, Math.floor((withSell.buy.fromSells + 100_000) / 15_000));
});

test("hold 현금 목표를 채우는 중이면 분배금은 지수가 아니라 현금으로 — 할 일 화면과 같은 규칙", () => {
  const holdings = [
    H("278530", "KODEX 200TR", 15_000, 300, 14_000),
    H("498400", "KODEX 200타겟위클리커버드콜", 16_000, 600, 18_000),
  ];
  const filling = reportFor(holdings, { incomeMode: "hold", customTargets: { income: 70, cash: 10 }, cashByAccount: { a: 200_000 } });
  const inflowStep = filling.steps.find((s) => s.includes("분배금(월"))!;
  assert.match(inflowStep, /현금 목표 10%까지 .* 현금으로 둡니다/);
  assert.match(filling.headline, /분배금은 현금으로/);
  assert.equal(filling.buy.fromCash, 0, "채우는 중인 예수금은 지수로 쓰지 않는다");

  // 현금 목표가 없으면 기존처럼 지수로
  const noTarget = reportFor(holdings, { incomeMode: "hold", customTargets: { income: 70 } });
  assert.match(noTarget.steps.find((s) => s.includes("분배금(월"))!, /KODEX 200TR로 보냅니다/);
  assert.doesNotMatch(noTarget.headline, /분배금은 현금으로/);
});

test("해외 비중이 ±20%p 벗어나면 리포트도 가이드처럼 벗어남을 말하고, 손실 종목은 그 때문에 팔지 않는다", () => {
  const r = reportFor([H("069500", "KODEX 200", 86_000, 100, 100_000), H("498400", "KODEX 200타겟위클리커버드콜", 16_000, 500, 18_000)], { incomeMode: "hold", customTargets: { income: 50 }, overseasPct: 50 });
  const last = r.steps.at(-1)!;
  assert.match(last, /성장 안 해외 비중 0%\(목표 50%\)/);
  assert.match(last, /해외 비중을 0으로/);
  assert.equal(r.sells.length, 0);
});
