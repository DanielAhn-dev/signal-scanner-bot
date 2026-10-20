// 무작위 계좌(시드 고정)로 가이드·할 일·리포트를 돌려 "언제나 맞아야 하는" 성질을 확인한다.
// 특정 사례 테스트가 놓치는 조합(보유 구성·손익·계좌·설정)에서 깨지는 계산을 찾기 위한 것.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INCOME_GUIDE_SETTINGS, buildIncomeGuideView, type GuideHolding, type IncomeGuideSettings } from "../src/lib/incomeGuide";
import { buildRebalancePlan } from "../src/lib/rebalancePlan";
import { buildRebalanceReport } from "../src/lib/rebalanceReport";
import { renderRebalanceReportHtml } from "../src/services/rebalanceReportRender";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const UNIVERSE: Array<[string, string, number]> = [
  ["069500", "KODEX 200", 87_000],
  ["278530", "KODEX 200TR", 31_000],
  ["102110", "TIGER 200", 87_000],
  ["360750", "TIGER 미국S&P500", 20_000],
  ["379800", "KODEX 미국S&P500", 19_000],
  ["498400", "KODEX 200타겟위클리커버드콜", 16_000],
  ["0167B0", "SOL 200타겟위클리커버드콜", 9_300],
  ["0219E0", "KODEX 200커버드콜액티브", 6_500],
  ["483290", "KODEX 미국배당다우존스타겟커버드콜", 9_900],
  ["0105E0", "SOL 코리아고배당", 12_100],
  ["161510", "PLUS 고배당주", 23_000],
  ["458730", "TIGER 미국배당다우존스", 14_500],
  ["329200", "TIGER 리츠부동산인프라", 4_000],
  ["153130", "KODEX 단기채권", 110_000],
  ["005930", "삼성전자", 210_000],
  ["000660", "SK하이닉스", 500_000],
  ["0190C0", "RISE 현대차고정피지컬AI", 6_700],
];
const ACCOUNTS: Array<[string, string]> = [
  ["a", "키움 / 일반"],
  ["b", "미래 / ISA"],
  ["c", "삼성 / 연금저축"],
];

function randomCase(seed: number) {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const nAcc = 1 + Math.floor(r() * 3);
  const holdings: GuideHolding[] = [];
  const n = 1 + Math.floor(r() * 12);
  for (let i = 0; i < n; i++) {
    const [code, name, price] = pick(UNIVERSE);
    const [key, label] = ACCOUNTS[Math.floor(r() * nAcc)];
    // DB 고유 제약(chat_id, code, account_name) — 같은 계좌에 같은 종목은 한 줄
    if (holdings.some((h) => h.accountKey === key && h.code === code)) continue;
    const qty = 1 + Math.floor(r() ** 2 * 800);
    // 평단: −40% ~ +300% 범위의 손익, 가끔 평단 없음
    const pnl = r() < 0.08 ? null : -0.4 + r() ** 3 * 3.4;
    holdings.push({ code, name, price, quantity: qty, avgPrice: pnl == null ? null : Math.round(price / (1 + pnl)), accountKey: key, accountLabel: label });
  }
  const hold = r() < 0.5;
  const income = pick([10, 40, 70]);
  const cash = pick([undefined, 0, 5, 10]);
  const cashByAccount: Record<string, number> = {};
  for (const [key] of ACCOUNTS.slice(0, nAcc)) if (r() < 0.5) cashByAccount[key] = Math.round(r() * 5_000_000);
  const settings: IncomeGuideSettings = {
    ...DEFAULT_INCOME_GUIDE_SETTINGS,
    incomeMode: hold ? "hold" : undefined,
    customTargets: { income, ...(cash != null ? { cash } : {}) },
    overseasPct: pick([0, 30, 50]),
    cashByAccount: Object.keys(cashByAccount).length ? cashByAccount : undefined,
    monthlyContribution: r() < 0.4 ? pick([300_000, 1_000_000]) : undefined,
    incomeKindsTarget: r() < 0.3 ? pick([3, 5]) : undefined,
  } as IncomeGuideSettings;
  const market = r() < 0.5 ? { asOf: "2026-10-19", changePct: -2, fromHighPct: -21 } : { asOf: "2026-10-19", changePct: 0.5, fromHighPct: -2 };
  return { holdings, settings, market };
}

function scanBad(obj: unknown, path = ""): string[] {
  const bad: string[] = [];
  if (typeof obj === "number" && !Number.isFinite(obj)) bad.push(`${path}=${obj}`);
  else if (typeof obj === "string" && /NaN|undefined|Infinity|\[object Object\]/.test(obj)) bad.push(`${path}="${obj.slice(0, 120)}"`);
  else if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) bad.push(...scanBad(v, `${path}.${k}`));
  return bad;
}

const N = Number(process.env.GUIDE_FUZZ_N ?? 400);
test(`무작위 계좌 ${N}개: 가이드·할 일·리포트 불변 성질`, () => {
  const failures: string[] = [];
  for (let seed = 1; seed <= N; seed++) {
    const { holdings, settings, market } = randomCase(seed);
    const fail = (msg: string) => failures.push(`seed ${seed}: ${msg}`);
    let view, plan;
    try {
      view = buildIncomeGuideView({ holdings, settings, today: "2026-10-19" });
      plan = buildRebalancePlan({ holdings: view.holdings, total: view.total, groups: view.groups, settings, cashPlan: view.cashPlan });
    } catch (e) {
      fail(`가이드/할 일 계산 예외 ${(e as Error).message}`);
      continue;
    }
    for (const b of scanBad(view, "view")) fail(b);
    for (const b of scanBad(plan, "plan")) fail(b);

    // 비중 합 100%
    const pctSum = view.groups.reduce((s, g) => s + g.actualPct, 0);
    if (view.total > 0 && Math.abs(pctSum - 100) > 0.01) fail(`바구니 비중 합 ${pctSum}`);
    const tgtSum = view.groups.reduce((s, g) => s + g.targetPct, 0);
    if (view.total > 0 && Math.abs(tgtSum - 100) > 0.01) fail(`목표 비중 합 ${tgtSum}`);

    // 가이드 주문안: 가진 것보다 많이 팔지 않고, 같은 계좌·종목은 한 번만
    const qtyOf = new Map<string, number>();
    for (const h of holdings) qtyOf.set(`${h.accountLabel}|${h.code}`, (qtyOf.get(`${h.accountLabel}|${h.code}`) ?? 0) + h.quantity);
    for (const o of view.rebalance.orders) {
      if (o.shares <= 0) fail(`주문안 0주 이하 ${o.name}`);
      if (o.side === "sell" && o.shares > (qtyOf.get(`${o.accountLabel}|${o.code}`) ?? 0)) fail(`주문안 보유보다 많이 매도 ${o.name} ${o.shares}`);
      if (Math.abs(o.amount - o.shares * o.price) > 1) fail(`주문안 금액≠수량×가격 ${o.name}`);
    }

    if (!plan) continue;
    for (const m of plan.merges) {
      if (m.from.code === m.to.code) fail(`합치기 자기 자신 ${m.from.name}`);
      if (m.from.accountLabel !== m.to.accountLabel) fail(`합치기 계좌 넘어감 ${m.from.name}`);
      if (m.from.shares > (qtyOf.get(`${m.from.accountLabel}|${m.from.code}`) ?? 0)) fail(`합치기 보유보다 많이 ${m.from.name}`);
    }
    if (plan.idleCash) {
      for (const a of plan.idleCash.accounts) {
        if (a.keep < 0 || a.spendable < 0 || a.keep + a.spendable !== a.balance) fail(`예수금 나눔 keep ${a.keep}+spendable ${a.spendable}≠${a.balance}`);
        if (a.spend > a.spendable) fail(`예수금보다 많이 산다 ${a.spend}>${a.spendable}`);
      }
    }

    for (const acc of view.accounts) {
      let report;
      try {
        report = buildRebalanceReport({ view, plan, accountKey: acc.key, market, monthlyContribution: view.accounts[0]?.key === acc.key ? settings.monthlyContribution : 0 });
      } catch (e) {
        fail(`리포트 예외 [${acc.label}] ${(e as Error).message}`);
        continue;
      }
      if (!report) continue;
      const where = `[${acc.label}]`;
      for (const b of scanBad(report, "report")) fail(`${where} ${b}`);
      try {
        const html = renderRebalanceReportHtml(report, "2026-10-19 10:00");
        if (/NaN|undefined|Infinity/.test(html.replace(/<script[\s\S]*?<\/script>/g, ""))) fail(`${where} HTML에 NaN/undefined`);
      } catch (e) {
        fail(`${where} 렌더 예외 ${(e as Error).message}`);
      }
      const rowSum = report.rows.reduce((s, x) => s + x.value, 0);
      const accHoldings = holdings.filter((h) => h.accountKey === acc.key);
      const expected = accHoldings.reduce((s, h) => s + h.quantity * h.price, 0);
      if (Math.abs(rowSum - expected) > 1) fail(`${where} 행 합계 ${rowSum} ≠ 보유 평가 ${expected}`);
      const wSum = report.rows.reduce((s, x) => s + x.weightPct, 0);
      if (report.rows.length && Math.abs(wSum - 100) > 0.05) fail(`${where} 계좌 안 비중 합 ${wSum.toFixed(2)}`);
      for (const s of report.sells) {
        if (s.shares <= 0) fail(`${where} 0주 매도 ${s.name}`);
        if (s.shares > (qtyOf.get(`${acc.label}|${s.code}`) ?? 0)) fail(`${where} 보유보다 많이 매도 ${s.name}`);
        if (s.net > s.amount) fail(`${where} 손에 남는 돈이 매도 금액보다 큼 ${s.name}`);
        // 손실 매도는 평단 −15% 이하 개별주를 지수로 옮기는 것(C69)뿐 — 하락 구간이어도 같다. 다른 종목·인컴으로 옮기지 않는다
        if (s.realizedGain < 0) {
          const row = report.rows.find((x) => x.code === s.code)
          const lossPct = row?.avgPrice ? (s.price / row.avgPrice - 1) * 100 : null
          if (!/C69/.test(s.reason) || lossPct == null || lossPct > -15) fail(`${where} C69가 아닌 손실 종목 매도 ${s.name}`);
          if ((s.to?.code ?? null) !== (report.buy.target?.code ?? null)) fail(`${where} 손실 개별주를 지수 아닌 곳으로 ${s.name}→${s.to?.name}`);
        }
      }
      for (const c of report.conditionals) {
        if (c.triggerPrice <= c.price) fail(`${where} 이미 닿은 조건부 ${c.name} ${c.triggerPrice}≤${c.price}`);
        if (c.shares <= 0) fail(`${where} 조건부 0주 ${c.name}`);
      }
      // 같은 종목에 '팔기'와 '조건부'가 동시에 나오면 안내가 모순
      for (const s of report.sells) if (report.conditionals.some((c) => c.code === s.code)) fail(`${where} 같은 종목 매도+조건부 ${s.name}`);
      // 살 돈보다 많이 사지 않는다
      if (report.buy.target && report.buy.shares * report.buy.target.price > report.buy.fromSells + report.buy.fromCash + 1)
        fail(`${where} 매수 금액이 판 대금+예수금보다 큼`);
      if (report.buy.target && !holdings.some((h) => h.accountKey === acc.key && h.code === report.buy.target!.code) && !/TR|200|S&P/.test(report.buy.target.name))
        fail(`${where} 이상한 매수 대상 ${report.buy.target.name}`);
      // 인컴 매수 멈춤이면 인컴 행에 매수 안내가 없어야
      if (report.income.stopReasons.length && report.rows.some((x) => x.group === "income" && x.action === "buy")) fail(`${where} 인컴 멈춤인데 인컴 매수`);
      // 현금 채우는 중이면 분배금은 현금으로
      if (plan.cash?.state === "filling" && report.steps.some((x) => x.includes("분배금(월") && !x.includes("현금으로 둡니다"))) fail(`${where} 현금 채우는 중인데 분배금을 지수로`);
      // 할 일과 리포트의 살 곳: 할 일의 살 곳이 이 계좌에 있으면 같은 종목이어야
      if (plan.buyTarget && plan.buyTarget.accountLabel === acc.label && report.buy.target && report.buy.target.code !== plan.buyTarget.code)
        fail(`${where} 살 곳 불일치: 할 일 ${plan.buyTarget.name} / 리포트 ${report.buy.target.name}`);
      // 문구 품질
      for (const s of report.steps) {
        if (/(?<![\d,])0주|약 0만원|\(0원\)/.test(s)) fail(`${where} 0 표기 문구: ${s.slice(0, 100)}`);
      }
    }
  }
  const uniq = [...new Set(failures.map((f) => f.replace(/^seed \d+: /, "").replace(/\d[\d,.]*/g, "#")))];
  assert.equal(failures.length, 0, `${failures.length}건 / 유형 ${uniq.length}개\n` + uniq.slice(0, 40).join("\n") + "\n--- 예시 ---\n" + failures.slice(0, 15).join("\n"));
});
