/**
 * 실계좌 리밸런싱 가이드 리포트 — 계좌 하나를 골라 "무엇을 팔고(수익 구간만) 무엇을 사고, 분배금은 어디로" 보낼지 문서로 만든다.
 * 주문하지 않는다. DB·API 없이 계산만 한다(렌더는 src/services/rebalanceReportRender.ts, 경로는 handlers/ui/rebalance-report.ts).
 *
 * 목표·인컴 하한은 계좌 하나가 아니라 전체 실계좌 기준이다(buildIncomeGuideView·buildRebalancePlan을 그대로 받는다).
 * 여기서는 고른 계좌의 종목만 골라 판정한다 — 매도 대금은 그 계좌 안에서만 쓸 수 있으므로 살 곳도 같은 계좌에서 찾는다.
 *
 * 매도 원칙: 평단 이상(수익 구간)일 때만 판다. 같은 이유로 팔 종목이 손실 구간이면 "평단 회복 시 정리" 조건부 목록에 둔다.
 *   - 개별주 평단 대비 +20%면 절반을 지수로 (C54, 실계좌 카드와 같은 규칙)
 *   - 겹치는 인컴 종목 합치기 (rebalancePlan merges — 같은 계좌·같은 지역·같은 바구니)
 *   - 커버드콜 일부를 지수로 (rebalancePlan trim — 월 인컴 하한을 지키는 최대치, hold 모드면 없음)
 * 근거 문장은 판정 등록부(docs/investment-idea-registry-2026-10-07.md)의 C48·C54와 블로그 3편 수치만 쓴다.
 */
import { BUCKET_LABEL, CASH_BALANCE_CODE, REBALANCE_BAND_PP, isTaxAdvantagedAccount, type AssetBucket, type BucketGroup, type IncomeGuideView } from "./incomeGuide";
import { holdingYieldPct, type RebalancePlan } from "./rebalancePlan";
import { KRX_SELL_TAX_RATE, resolveOtherEtfGainTax, resolveSellTaxRate } from "./securitiesTax";

/** 매도 수수료 가정 (온라인 기준) */
export const SELL_FEE_RATE = 0.00015;
const DISTRIBUTION_TAX = 0.154;
/** 개별주 평단 대비 이만큼 오르면 절반을 지수로 (C54) */
export const STOCK_TRIM_PCT = 20;
/** 개별주 손실이 이보다 크면 추가매수 멈춤 (satelliteGuard와 같은 값) */
export const STOCK_LOSS_STOP_PCT = -15;
/** 커버드콜은 인컴의 1/3 이하 (holdingAction과 같은 값) */
export const COVERED_CALL_MAX_SHARE_PCT = 100 / 3;
/** 코스피가 최근 고점 대비 이만큼 빠졌으면 "하락 구간"으로 본다 */
export const DRAWDOWN_ALERT_PCT = -10;

const FOREIGN = /(미국|나스닥|S&P|다우존스|글로벌|선진|중국|차이나|일본|인도|베트남|유럽)/i;

export type EtfYield = { yieldTtm: number | null; fee: number | null };
export type MarketContext = { asOf: string; changePct: number; fromHighPct: number };

export type ReportAction = "sell" | "sell-later" | "buy" | "stop-add" | "hold";

export type ReportRow = {
  code: string;
  name: string;
  bucketLabel: string;
  group: BucketGroup;
  quantity: number;
  avgPrice: number | null;
  price: number;
  value: number;
  pnl: number | null;
  pnlPct: number | null;
  /** 계좌 안 비중 % */
  weightPct: number;
  yieldPct: number;
  yieldSource: "ttm" | "assumed";
  /** 월 분배금 추정 (세후, 계좌 과세 기준) */
  monthlyNet: number;
  action: ReportAction;
  actionText: string;
};

export type ReportSell = {
  code: string;
  name: string;
  shares: number;
  price: number;
  amount: number;
  realizedGain: number;
  /** 거래세·수수료·매매차익 과세 추정 */
  cost: number;
  /** 손에 남는 돈 */
  net: number;
  /** 월 분배금(세후) 변화 추정 — 판 만큼 줄고, 산 곳에서 생기는 분배금은 더한다 */
  monthlyIncomeDelta: number;
  to: { code: string; name: string } | null;
  reason: string;
};

export type ReportConditional = {
  code: string;
  name: string;
  /** 이 가격 이상이면 실행 */
  triggerPrice: number;
  price: number;
  shares: number;
  reason: string;
};

export type RebalanceReport = {
  today: string;
  account: {
    key: string;
    label: string;
    taxAdvantaged: boolean;
    total: number;
    cost: number | null;
    pnl: number | null;
    pnlPct: number | null;
    shareOfAllPct: number;
    holdingCount: number;
  };
  portfolio: {
    total: number;
    accountCount: number;
    groups: Array<{ label: string; actualPct: number; targetPct: number; outOfBand: boolean }>;
    targetSource: IncomeGuideView["targetSource"];
  };
  accountGroups: Array<{ group: BucketGroup; label: string; value: number; pct: number }>;
  market: (MarketContext & { drawdown: boolean }) | null;
  income: {
    accountMonthlyNet: number;
    portfolioMonthlyNet: number | null;
    portfolioSource: "actual" | "estimate" | null;
    floor: number;
    surplus: number | null;
    accountIncomePct: number;
    portfolioIncomePct: number;
    portfolioIncomeTargetPct: number;
    coveredCallShareOfIncomePct: number;
    hold: boolean;
    /** 인컴 추가매수를 멈출 이유들 (비었으면 멈출 이유 없음) */
    stopReasons: string[];
    lines: string[];
  };
  rows: ReportRow[];
  sells: ReportSell[];
  conditionals: ReportConditional[];
  buy: {
    target: { code: string; name: string; price: number } | null;
    hint: string;
    fromSells: number;
    monthlyDistribution: number;
    monthlyContribution: number;
    shares: number;
  };
  growth: { actualPct: number; targetPct: number; needByNewMoney: number; months: number | null } | null;
  headline: string;
  steps: string[];
  notes: string[];
};

const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}원`;
const man = (v: number) => `${Math.round(v / 10_000).toLocaleString("ko-KR")}만원`;
const signedPct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

/** 매도 비용 — ETF는 거래세 없음, 개별주 0.20%. 일반 계좌의 해외 기초 ETF·기타 ETF는 매매차익 15.4% */
export function estimateSellCost(input: { code: string; name: string; amount: number; gain: number; taxAdvantaged: boolean }): number {
  const { code, name, amount, gain, taxAdvantaged } = input;
  const tax = taxAdvantaged ? 0 : amount * resolveSellTaxRate({ code, name, baseRate: KRX_SELL_TAX_RATE });
  let gainTax = 0;
  if (!taxAdvantaged && gain > 0) {
    gainTax = FOREIGN.test(name) ? gain * DISTRIBUTION_TAX : resolveOtherEtfGainTax({ code, gain });
  }
  return Math.round(amount * SELL_FEE_RATE + tax + gainTax);
}

export function buildRebalanceReport(input: {
  view: IncomeGuideView;
  plan: RebalancePlan | null;
  accountKey: string;
  etf?: Map<string, EtfYield>;
  market?: MarketContext | null;
  /** 이 계좌에 매달 넣는 돈 (없으면 0) */
  monthlyContribution?: number;
}): RebalanceReport | null {
  const { view, plan, accountKey } = input;
  const etf = input.etf ?? new Map<string, EtfYield>();
  const acc = view.accounts.find((a) => a.key === accountKey);
  const held = view.holdings.filter((h) => h.accountKey === accountKey && h.code !== CASH_BALANCE_CODE);
  if (!acc || held.length === 0) return null;

  const taxAdvantaged = isTaxAdvantagedAccount(acc.label);
  const keep = taxAdvantaged ? 1 : 1 - DISTRIBUTION_TAX;
  const total = held.reduce((s, h) => s + h.value, 0);
  const yieldOf = (code: string, bucket: AssetBucket, name: string) => {
    const ttm = etf.get(code)?.yieldTtm;
    return ttm != null && ttm >= 0 ? { pct: ttm, source: "ttm" as const } : { pct: holdingYieldPct(bucket, name), source: "assumed" as const };
  };
  const monthlyOf = (code: string, bucket: AssetBucket, name: string, value: number) => ((value * yieldOf(code, bucket, name).pct) / 100 / 12) * keep;

  // 살 곳 — 같은 계좌의 성장 ETF: 일반 계좌면 TR형 먼저, 아니면 가장 큰 것
  const growthHeld = held.filter((h) => h.group === "growth").sort((a, b) => b.value - a.value);
  const buyRow = (!taxAdvantaged ? growthHeld.find((h) => /TR/i.test(h.name)) : undefined) ?? growthHeld[0] ?? null;
  const buyTarget = buyRow ? { code: buyRow.code, name: buyRow.name, price: buyRow.price } : null;
  const buyHint = buyRow
    ? !taxAdvantaged && /TR/i.test(buyRow.name)
      ? "일반 계좌라 분배금을 자동 재투자해 과세를 미루는 TR형으로 모읍니다. 다른 지수 ETF는 팔지 않고 둡니다."
      : "이 계좌에 이미 있는 지수 ETF 한 곳으로만 모읍니다. 여러 곳에 나눠 사면 종류만 늘어납니다."
    : taxAdvantaged
      ? "이 계좌에 지수 ETF가 없습니다. ISA·연금 계좌는 해외 지수(S&P500 등)를 두면 매매차익·분배금 과세가 미뤄져 유리합니다."
      : "이 계좌에 지수 ETF가 없습니다. 일반 계좌는 분배금 과세를 미루는 코스피200 TR형이 유리합니다.";

  const sells: ReportSell[] = [];
  const conditionals: ReportConditional[] = [];
  const sellNote = new Map<string, string>();
  const laterNote = new Map<string, string>();

  const pushSell = (h: (typeof held)[number], shares: number, reason: string, to: { code: string; name: string; price: number } | null) => {
    if (shares <= 0) return;
    const amount = Math.round(shares * h.price);
    const gain = h.avgPrice ? Math.round((h.price - h.avgPrice) * shares) : 0;
    const cost = estimateSellCost({ code: h.code, name: h.name, amount, gain, taxAdvantaged });
    const net = amount - cost;
    const lost = monthlyOf(h.code, h.bucket, h.name, amount);
    const toRow = to ? held.find((x) => x.code === to.code) : null;
    const gained = toRow ? monthlyOf(toRow.code, toRow.bucket, toRow.name, net) : 0;
    sells.push({
      code: h.code,
      name: h.name,
      shares,
      price: h.price,
      amount,
      realizedGain: gain,
      cost,
      net,
      monthlyIncomeDelta: Math.round(gained - lost),
      to: to ? { code: to.code, name: to.name } : null,
      reason,
    });
  };
  const inProfit = (h: { price: number; avgPrice?: number | null }) => h.avgPrice == null || h.avgPrice <= 0 || h.price >= h.avgPrice;

  // ① 개별주 +20%는 절반을 지수로, 그 아래는 +20% 가격을 조건으로 둔다
  for (const h of held) {
    if (h.bucket !== "stock" || !h.avgPrice) continue;
    const p = (h.price / h.avgPrice - 1) * 100;
    const half = Math.floor(h.quantity / 2);
    if (half <= 0) continue;
    if (p >= STOCK_TRIM_PCT) {
      pushSell(h, half, `개별주 평단 대비 ${signedPct(p)} — 절반을 지수로 (C54). 이미 한 번 절반을 판 종목이면 건너뜁니다.`, buyTarget);
      sellNote.set(h.code, `절반(${half}주) 팔아 지수로`);
    } else if (p >= STOCK_LOSS_STOP_PCT) {
      const trigger = Math.ceil(h.avgPrice * (1 + STOCK_TRIM_PCT / 100));
      conditionals.push({ code: h.code, name: h.name, triggerPrice: trigger, price: h.price, shares: half, reason: `평단 +${STOCK_TRIM_PCT}%에 처음 닿으면 절반을 지수로 (C54)` });
    }
  }

  // ② 겹치는 인컴 합치기 — 이 계좌 것만, 수익 구간이면 지금, 손실 구간이면 평단 회복 시
  for (const m of plan?.merges ?? []) {
    const h = held.find((x) => x.code === m.from.code);
    if (!h) continue;
    const to = held.find((x) => x.code === m.to.code);
    if (inProfit(h)) {
      pushSell(h, h.quantity, `합치기: ${m.reason}`, to ? { code: to.code, name: to.name, price: to.price } : null);
      sellNote.set(h.code, `전량 팔아 ${m.to.name}로 합치기`);
    } else {
      conditionals.push({ code: h.code, name: h.name, triggerPrice: Math.ceil(h.avgPrice!), price: h.price, shares: h.quantity, reason: `평단 회복 시 ${m.to.name}로 합치기 (${m.reason})` });
      laterNote.set(h.code, `손실 구간 — 평단 ${won(h.avgPrice!)} 회복 시 ${m.to.name}로 합치기`);
    }
  }

  // ③ 커버드콜 일부를 지수로 — 월 인컴 하한을 지키는 최대치(rebalancePlan), 수익 구간일 때만
  const t = plan?.trim;
  if (t && t.maxShares > 0 && !sellNote.has(t.code)) {
    const h = held.find((x) => x.code === t.code);
    if (h) {
      if (inProfit(h)) {
        pushSell(h, Math.min(t.maxShares, h.quantity), `커버드콜 일부를 지수로 — ${t.note}`, buyTarget);
        sellNote.set(h.code, `${Math.min(t.maxShares, h.quantity)}주까지 팔아 지수로`);
      } else {
        conditionals.push({ code: h.code, name: h.name, triggerPrice: Math.ceil(h.avgPrice!), price: h.price, shares: Math.min(t.maxShares, h.quantity), reason: "평단 회복 시 커버드콜 일부를 지수로 (월 인컴 하한 안에서)" });
        laterNote.set(h.code, `손실 구간 — 평단 ${won(h.avgPrice!)} 회복 시 일부 지수로`);
      }
    }
  }
  sells.sort((a, b) => b.amount - a.amount);
  conditionals.sort((a, b) => a.triggerPrice / a.price - b.triggerPrice / b.price);

  // 인컴 판단 (계좌·전체)
  const incomeHeld = held.filter((h) => h.group === "income");
  const incomeValue = incomeHeld.reduce((s, h) => s + h.value, 0);
  const ccValue = incomeHeld.filter((h) => h.bucket === "covered_call").reduce((s, h) => s + h.value, 0);
  const ccShare = incomeValue > 0 ? (ccValue / incomeValue) * 100 : 0;
  const pIncome = view.groups.find((g) => g.group === "income");
  const portfolioIncomePct = pIncome?.actualPct ?? 0;
  const portfolioIncomeTargetPct = pIncome?.targetPct ?? 0;
  const hold = plan?.hold ?? false;
  const floor = plan?.income.floor ?? Math.max(0, view.settings.monthlyNeed);
  const surplus = plan ? plan.income.surplus : null;
  const stopReasons: string[] = [];
  if (surplus != null && surplus >= 0 && floor > 0) stopReasons.push(`월 인컴(${man(plan!.income.monthlyNet)})이 목표 ${man(floor)}를 이미 넘었습니다`);
  if (ccShare > COVERED_CALL_MAX_SHARE_PCT) stopReasons.push(`이 계좌 인컴 중 커버드콜이 ${ccShare.toFixed(0)}%로 상한 33%를 넘었습니다`);
  if (!hold && portfolioIncomePct > portfolioIncomeTargetPct + REBALANCE_BAND_PP)
    stopReasons.push(`전체 인컴 비중 ${portfolioIncomePct.toFixed(0)}%가 목표 ${portfolioIncomeTargetPct.toFixed(0)}% +${REBALANCE_BAND_PP}%p를 넘었습니다`);
  if (hold) stopReasons.push("인컴은 사지도 팔지도 않고 분배금으로 줄여 가는 중(hold)으로 정해 두었습니다");

  // 종목별 행
  const rows: ReportRow[] = held
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((h) => {
      const y = yieldOf(h.code, h.bucket, h.name);
      const pnl = h.avgPrice ? Math.round((h.price - h.avgPrice) * h.quantity) : null;
      const pnlPct = h.avgPrice ? (h.price / h.avgPrice - 1) * 100 : null;
      let action: ReportAction = "hold";
      let actionText = "그대로 둡니다";
      if (sellNote.has(h.code)) {
        action = "sell";
        actionText = sellNote.get(h.code)!;
      } else if (laterNote.has(h.code)) {
        action = "sell-later";
        actionText = laterNote.get(h.code)!;
      } else if (buyTarget && h.code === buyTarget.code) {
        action = "buy";
        actionText = "매도 대금·분배금·새 돈을 여기로";
      } else if (h.group === "income" && stopReasons.length > 0) {
        action = "stop-add";
        actionText = pnlPct != null && pnlPct < 0 ? "손실 구간 — 팔지 않고, 더 사지도 않습니다" : "더 사지 않습니다 (분배금은 지수로)";
      } else if (h.bucket === "stock" && pnlPct != null && pnlPct <= STOCK_LOSS_STOP_PCT) {
        action = "stop-add";
        actionText = `손실 ${signedPct(pnlPct)} — 물타기 금지, 더 사지 않습니다`;
      } else if (h.bucket === "leveraged") {
        action = "stop-add";
        actionText = "레버리지는 세후 이득이 없어 더 사지 않습니다";
      } else if (pnlPct != null && pnlPct < 0) {
        actionText = "손실 구간 — 팔지 않고 둡니다";
      }
      return {
        code: h.code,
        name: h.name,
        bucketLabel: BUCKET_LABEL[h.bucket],
        group: h.group,
        quantity: h.quantity,
        avgPrice: h.avgPrice ?? null,
        price: h.price,
        value: h.value,
        pnl,
        pnlPct,
        weightPct: total > 0 ? (h.value / total) * 100 : 0,
        yieldPct: y.pct,
        yieldSource: y.source,
        monthlyNet: Math.round(monthlyOf(h.code, h.bucket, h.name, h.value)),
        action,
        actionText,
      };
    });
  const accountMonthlyNet = rows.reduce((s, r) => s + r.monthlyNet, 0);

  // 계좌 손익
  const withCost = held.filter((h) => h.avgPrice && h.avgPrice > 0);
  const costBasis = withCost.length === held.length ? withCost.reduce((s, h) => s + h.avgPrice! * h.quantity, 0) : null;
  const pnl = costBasis != null ? Math.round(total - costBasis) : null;

  // 계좌 바구니
  const groupOrder: BucketGroup[] = ["growth", "income", "satellite", "cash"];
  const groupLabel: Record<BucketGroup, string> = { growth: "성장 (지수)", income: "인컴 (분배형)", satellite: "위성 (개별주·테마)", cash: "현금성" };
  const accountGroups = groupOrder
    .map((g) => {
      const value = held.filter((h) => h.group === g).reduce((s, h) => s + h.value, 0);
      return { group: g, label: groupLabel[g], value, pct: total > 0 ? (value / total) * 100 : 0 };
    })
    .filter((g) => g.value > 0);

  // 시장
  const market = input.market ? { ...input.market, drawdown: input.market.fromHighPct <= DRAWDOWN_ALERT_PCT } : null;

  // 하락장 인컴 추가매수에 대한 설명 (사용자가 하락장에서 커버드콜·고배당을 더 사며 버티는 중, 2026-10-15)
  const incomeLines: string[] = [];
  const accountIncomePct = total > 0 ? (incomeValue / total) * 100 : 0;
  if (incomeValue > 0) {
    incomeLines.push(
      `커버드콜은 하락장에서 산 뒤 지수가 반등해도 상승분의 절반~3분의 2만 따라옵니다(블로그 3편, 한국·미국 1세대). 지금 커버드콜을 더 사면 분배금은 늘지만, 회복 구간의 수익을 미리 팔아 두는 것과 같습니다.`,
      `고배당이 하락장에서 덜 빠진다는 것도 일관되지 않았습니다(C48). 2022·2026 하락에서는 크게 방어했지만 2018~2020 구간에서는 지수보다 더 빠졌고, 2020년 반등 때 지수 +37%를 고배당은 −5~+6%로 거의 못 따라갔습니다.`,
      `버티는 데 필요한 것은 생활비 현금 흐름입니다. 분배금을 생활비로 쓰지 않는다면, 분배금을 받아서 지수로 보내는 것이 하락장에서 싼 지수를 사는 효과를 그대로 얻는 방법입니다.`,
    );
    if (surplus != null && floor > 0) {
      incomeLines.push(
        surplus >= 0
          ? `전체 월 인컴 ${man(plan!.income.monthlyNet)}(${plan!.income.source === "actual" ? "실제 입금" : "추정"})이 목표 ${man(floor)}를 넘었습니다. 계획대로라면 지금이 인컴 추가매수를 멈출 때입니다.`
          : `전체 월 인컴 ${man(plan!.income.monthlyNet)}(${plan!.income.source === "actual" ? "실제 입금" : "추정"})은 목표 ${man(floor)}보다 ${man(-surplus)} 적습니다. 인컴을 더 채운다면 커버드콜 비중(지금 ${ccShare.toFixed(0)}%)이 인컴의 1/3을 넘지 않는 범위에서 고배당 쪽으로 채우는 것이 반등을 덜 포기합니다.`,
      );
    }
  }

  const monthlyContribution = Math.max(0, Math.round(input.monthlyContribution ?? 0));
  const fromSells = sells.filter((s) => s.to && buyTarget && s.to.code === buyTarget.code).reduce((s, x) => s + x.net, 0);
  const buyShares = buyTarget && buyTarget.price > 0 ? Math.floor(fromSells / buyTarget.price) : 0;

  // 맨 위 한 줄
  const parts: string[] = [];
  if (market?.drawdown) parts.push(`코스피가 최근 고점 대비 ${market.fromHighPct.toFixed(1)}%인 하락 구간 — 손실 종목은 팔지 않습니다`);
  if (sells.length) parts.push(`수익 구간 ${sells.length}건 정리 → ${buyTarget ? buyTarget.name : "지수"}`);
  else parts.push("지금 팔 종목은 없습니다(수익 구간에 정리 대상 없음)");
  if (conditionals.length) parts.push(`가격 조건부 ${conditionals.length}건 대기`);
  if (stopReasons.length && incomeValue > 0) parts.push("인컴 추가매수 멈춤");
  const headline = parts.join(" · ");

  // 실행 순서
  const steps: string[] = [];
  if (sells.length) {
    steps.push(`수익 구간 종목부터 팝니다: ${sells.map((s) => `${s.name} ${s.shares.toLocaleString("ko-KR")}주`).join(", ")}. 한 번에 다 팔 필요는 없고, 분배락일 직전이면 분배금을 받은 뒤 팝니다.`);
    // 옮길 곳별로 묶는다 — 합치기 대금은 남길 인컴 종목으로, 나머지는 지수로
    const byDest = new Map<string, { name: string; price: number; net: number }>();
    for (const s of sells) {
      if (!s.to) continue;
      const price = held.find((h) => h.code === s.to!.code)?.price ?? 0;
      const d = byDest.get(s.to.code) ?? { name: s.to.name, price, net: 0 };
      d.net += s.net;
      byDest.set(s.to.code, d);
    }
    const buys = [...byDest.values()].filter((d) => d.price > 0).map((d) => `${d.name} 약 ${Math.floor(d.net / d.price).toLocaleString("ko-KR")}주(${man(d.net)})`);
    if (buys.length) steps.push(`판 날 같은 계좌에서 바로 삽니다: ${buys.join(", ")}. 현금으로 들고 기다리지 않습니다.`);
  }
  steps.push(
    buyTarget
      ? `이번 달부터 분배금(월 약 ${man(accountMonthlyNet)})${monthlyContribution > 0 ? `과 새 돈(월 ${man(monthlyContribution)})` : ""}이 들어오면 ${buyTarget.name}로 보냅니다.`
      : `분배금(월 약 ${man(accountMonthlyNet)})을 모아 지수 ETF를 하나 정해 사기 시작합니다. ${buyHint}`,
  );
  if (stopReasons.length && incomeValue > 0) steps.push(`인컴(커버드콜·배당) 추가매수를 멈춥니다 — ${stopReasons[0]}.`);
  if (conditionals.length) steps.push(`가격 조건부 목록은 월 1회 점검 때만 봅니다. 조건 가격에 닿은 종목만 실행하고, 매일 확인하지 않습니다.`);
  steps.push(`다음 점검은 한 달 뒤입니다. 바구니가 목표 ±${REBALANCE_BAND_PP}%p를 넘을 때만 팔고, 그 안에서는 새 돈 방향만 바꿉니다.`);

  const notes = [
    "안내만 하며 주문하지 않습니다. 수익을 보장하지 않으며, 근거는 과거 자료 검증 결과입니다(판정 등록부 C48·C54, 블로그 3편).",
    "분배율은 네이버 최근 12개월 분배율을 쓰고, 없으면 상품 유형별 가정입니다. 분배금은 매달 같지 않습니다.",
    "매도 비용은 수수료 0.015%, 개별주 거래세 0.20%, 일반 계좌의 해외 기초 ETF 매매차익 15.4%(과표기준가 대신 매매차익으로 근사)를 뺀 추정입니다.",
    "목표 비중·인컴 하한은 이 계좌가 아니라 입력한 실계좌 전체 기준입니다. 예금·입력하지 않은 계좌는 빠져 있습니다.",
  ];
  if (rows.some((r) => r.avgPrice == null)) notes.push("평균 매수가가 없는 종목은 수익 구간 판단 없이 그대로 둡니다.");

  return {
    today: view.today,
    account: {
      key: acc.key,
      label: acc.label,
      taxAdvantaged,
      total,
      cost: costBasis != null ? Math.round(costBasis) : null,
      pnl,
      pnlPct: costBasis ? (total / costBasis - 1) * 100 : null,
      shareOfAllPct: view.total > 0 ? (total / view.total) * 100 : 0,
      holdingCount: held.length,
    },
    portfolio: {
      total: view.total,
      accountCount: view.accounts.filter((a) => a.key !== "__cash").length,
      groups: view.groups.map((g) => ({ label: g.label, actualPct: g.actualPct, targetPct: g.targetPct, outOfBand: Math.abs(g.diffPct) > REBALANCE_BAND_PP })),
      targetSource: view.targetSource,
    },
    accountGroups,
    market,
    income: {
      accountMonthlyNet,
      portfolioMonthlyNet: plan?.income.monthlyNet ?? null,
      portfolioSource: plan?.income.source ?? null,
      floor,
      surplus,
      accountIncomePct,
      portfolioIncomePct,
      portfolioIncomeTargetPct,
      coveredCallShareOfIncomePct: ccShare,
      hold,
      stopReasons,
      lines: incomeLines,
    },
    rows,
    sells,
    conditionals,
    buy: { target: buyTarget, hint: buyHint, fromSells, monthlyDistribution: accountMonthlyNet, monthlyContribution, shares: buyShares },
    growth: plan ? { actualPct: plan.growth.actualPct, targetPct: plan.growth.targetPct, needByNewMoney: plan.growth.needByNewMoney, months: plan.growth.months } : null,
    headline,
    steps,
    notes,
  };
}
