/**
 * 실계좌 리밸런싱 가이드 리포트 — 계좌 하나를 골라 "무엇을 팔고(수익 구간만) 무엇을 사고, 분배금은 어디로" 보낼지 문서로 만든다.
 * 주문하지 않는다. DB·API 없이 계산만 한다(렌더는 src/services/rebalanceReportRender.ts, 경로는 handlers/ui/rebalance-report.ts).
 *
 * 목표·인컴 하한은 계좌 하나가 아니라 전체 실계좌 기준이다(buildIncomeGuideView·buildRebalancePlan을 그대로 받는다).
 * 여기서는 고른 계좌의 종목만 골라 판정한다 — 매도 대금은 그 계좌 안에서만 쓸 수 있으므로 살 곳도 같은 계좌에서 찾는다.
 *
 * 매도 원칙: ETF끼리 옮기는 것(합치기·커버드콜 일부·같은 지수 상품)은 평단 이상일 때만 한다. 이득(보수·겹침 차이)이 작아 급하지 않으므로
 *   손실 구간이면 "평단 회복 시" 조건부 목록에 둔다.
 *   - 개별주 평단 대비 +20%면 절반을 지수로 (C54, 실계좌 카드와 같은 규칙)
 *   - 개별주 평단 대비 −15% 이하면 지금 전량 지수로 (C69, 실계좌 카드와 같은 규칙). 손실 구간 예외 — 계속 보유보다 1년 뒤 중앙 22%p 덜 남았고
 *     평단 회복을 기다리면 큰 손실 꼬리가 남았다. 같은 날 지수를 사므로 시장 노출은 그대로다.
 *   - 겹치는 인컴 종목 합치기 (rebalancePlan merges — 같은 계좌·같은 지역·같은 바구니)
 *   - 커버드콜 일부를 지수로 (rebalancePlan trim — 월 인컴 하한을 지키는 최대치, hold 모드면 없음)
 * 근거 문장은 판정 등록부(docs/investment-idea-registry-2026-10-07.md)의 C48·C54와 블로그 3편 수치만 쓴다.
 */
import { planMixLineForAccount, type PlanMixLine } from "./planMixGuide";
import { BUCKET_LABEL, CASH_BALANCE_CODE, REBALANCE_BAND_PP, isTaxAdvantagedAccount, resolveYieldPct, type AssetBucket, type BucketGroup, type IncomeGuideView } from "./incomeGuide";
import { FEE_TIE_PP, strategyKey, type RebalancePlan } from "./rebalancePlan";
import { KRX_SELL_TAX_RATE, resolveOtherEtfGainTax, resolveSellTaxRate } from "./securitiesTax";
import { buildReportReliability, type ReportReliability } from "./reportReliability";
import { buildReportStress, type ReportStress } from "./reportStress";
import { chooseIndexBuy, newMoneyFromSettings, type EtfYield, type FeeAlternative } from "./indexProductChoice";

/** 매도 수수료 가정 (온라인 기준) */
export const SELL_FEE_RATE = 0.00015;
const DISTRIBUTION_TAX = 0.154;
/** 개별주 평단 대비 이만큼 오르면 절반을 지수로 (C54) */
export const STOCK_TRIM_PCT = 20;
/** 개별주 손실이 이 이하면 지수로 옮긴다 (C69, holdingAction·satelliteGuard와 같은 값) */
export const STOCK_LOSS_STOP_PCT = -15;
/** 커버드콜은 인컴의 1/3 이하 (holdingAction과 같은 값) */
export const COVERED_CALL_MAX_SHARE_PCT = 100 / 3;
/** 코스피가 최근 고점 대비 이만큼 빠졌으면 "하락 구간"으로 본다 */
export const DRAWDOWN_ALERT_PCT = -10;

// 같은 지수 상품 고르기는 가이드와 함께 쓰는 src/lib/indexProductChoice.ts에 있다 (예전 경로로 import하는 곳을 위해 다시 내보낸다)
export { FEE_SWITCH_PP, MAX_DEVIATION_PCT, MIN_MARKET_CAP, RETURN_GAP_PP, pickIndexProduct, sameIndexKey } from "./indexProductChoice";
export type { EtfYield, FeeAlternative, IndexCandidate, IndexPick } from "./indexProductChoice";
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
  /** 총보수 % (직접 입력 → 네이버 순, 없으면 null) */
  fee: number | null;
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
  /** 분배금이 나오는 인컴 종목 — 분배락일 직전이면 받은 뒤 판다 */
  paysDistribution: boolean;
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
  /** 살 곳과 같은 지수 상품의 총보수 비교 (자료가 둘 이상일 때만) */
  feeCompare: Array<{
    code: string;
    name: string;
    fee: number;
    marketCap: number | null;
    return1y: number | null;
    deviation: number | null;
    held: boolean;
    chosen: boolean;
    /** 선정·제외 이유 */
    note: string;
  }>;
  /** 같은 지수 상품 중 고른 이유 (비교 자료가 있을 때) */
  feeWhy: string | null;
  /** 더 싼 같은 지수 상품으로 새 돈 방향을 바꿨을 때 */
  feeSwitch: { from: { code: string; name: string; fee: number }; to: { code: string; name: string; fee: number }; text: string } | null;
  buy: {
    target: { code: string; name: string; price: number } | null;
    hint: string;
    fromSells: number;
    /** 이 계좌 예수금 중 현금 목표 몫을 뺀, 지금 살 데 쓸 돈 */
    fromCash: number;
    monthlyDistribution: number;
    monthlyContribution: number;
    shares: number;
  };
  growth: { actualPct: number; targetPct: number; needByNewMoney: number; months: number | null } | null;
  /** 인컴 종목 압축 (가이드 설정에 목표 종목 수가 있을 때만). 역할 표는 전체 실계좌 기준, moves는 이 계좌 것만 */
  compress:
    | (NonNullable<RebalancePlan["compress"]> & {
        moves: Array<{
          from: { code: string; name: string };
          to: { code: string; name: string };
          /** "now"면 수익 구간이라 지금, 아니면 손실 구간의 회복 조건 문구 */
          when: string;
          taxedGain: boolean;
          monthlyIncomeDelta: number;
        }>;
      })
    | null;
  /** 하락 가정에서 이 계좌 평가금이 얼마나 줄지 (예수금 제외, 예측 아님) */
  stress: ReportStress | null;
  /** 숫자의 재료가 믿을 만한지 */
  reliability: ReportReliability;
  headline: string;
  steps: string[];
  notes: string[];
};

const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}원`;
const man = (v: number) => `${Math.round(v / 10_000).toLocaleString("ko-KR")}만원`;
/** 10만원 미만은 원 단위로 — "약 0만원"·"약 1만원"처럼 뭉개지지 않게 */
const money = (v: number) => (Math.abs(v) < 100_000 ? won(v) : man(v));
const signedPct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

/**
 * 매도 비용 — ETF는 거래세 없음, 개별주 0.20%. 일반 계좌의 기타 ETF(해외주식·채권·금·파생 등, 국내주식형이 아닌 ETF)는
 * 매매차익 15.4%. 기타 ETF 판정은 securitiesTax.resolveEtfTaxClass 하나로 한다(stocks.etf_tax_class가 있으면 그 값).
 */
export function estimateSellCost(input: {
  code: string;
  name: string;
  productType?: string | null;
  etfTaxClass?: string | null;
  amount: number;
  gain: number;
  taxAdvantaged: boolean;
}): number {
  const { code, name, productType, etfTaxClass, amount, gain, taxAdvantaged } = input;
  const tax = taxAdvantaged ? 0 : amount * resolveSellTaxRate({ code, name, productType, baseRate: KRX_SELL_TAX_RATE });
  const gainTax = taxAdvantaged ? 0 : resolveOtherEtfGainTax({ code, name, productType, etfTaxClass, gain });
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
  /** 살 곳과 같은 지수의 다른 상품들 — 총보수가 더 낮으면 새 돈·분배금을 그쪽으로 */
  feeAlternatives?: FeeAlternative[];
  /** 내 계획 구성(여러 지수) — 이 계좌가 맡은 몫을 할 일에 한 줄로 (src/lib/planMixGuide.ts). 없으면 예전처럼 한 곳 */
  planMixLines?: PlanMixLine[] | null;
  /** 실시간가를 받은 종목 코드 (없으면 실시간 여부는 점검하지 않는다) */
  realtimeCodes?: Set<string>;
  /** 이 계좌에서 가격이 없어 가이드 계산에서 빠진 종목 이름 */
  unpricedNames?: string[];
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
    return resolveYieldPct(code, bucket, name, ttm != null ? { [code]: ttm } : null);
  };
  const monthlyOf = (code: string, bucket: AssetBucket, name: string, value: number) => ((value * yieldOf(code, bucket, name).pct) / 100 / 12) * keep;

  // 살 곳 — 같은 계좌의 성장 ETF 중 기준 상품을 정하고 같은 지수 상품과 비교 (가이드 ①·예수금·분배금과 같은 함수)
  const growthHeld = held.filter((h) => h.group === "growth").sort((a, b) => b.value - a.value);
  // 총보수: 리밸런싱 가이드에서 직접 넣은 값 → 네이버 → 대체 상품 조회값
  const alts = (input.feeAlternatives ?? []).filter((a) => a.price > 0);
  const feeOf = (code: string): number | null =>
    view.settings.feePctByCode?.[code] ?? etf.get(code)?.fee ?? alts.find((a) => a.code === code)?.fee ?? null;
  const choice = chooseIndexBuy({
    growthHeld,
    taxAdvantaged,
    alternatives: alts,
    feeOf,
    infoOf: (code) => etf.get(code) ?? alts.find((a) => a.code === code),
    newMoney: newMoneyFromSettings(view.settings, view.today),
  });
  const buyRow = choice.base;
  const buyTarget = choice.target;
  const pick = choice.pick;
  let feeSwitch: RebalanceReport["feeSwitch"] = null;
  let feeCompare: RebalanceReport["feeCompare"] = [];
  let feeWhy: string | null = null;
  if (buyRow && buyTarget && pick) {
    const currentFee = feeOf(buyRow.code);
    if (buyTarget.code !== buyRow.code) {
      const to = pick.chosen;
      const feeGap = currentFee != null ? currentFee - to.fee : 0;
      const perTenMillion = Math.round((feeGap / 100) * 10_000_000);
      const whyNotCurrent = pick.notes.get(buyRow.code);
      feeSwitch = {
        from: { code: buyRow.code, name: buyRow.name, fee: currentFee ?? to.fee },
        to: { code: to.code, name: to.name, fee: to.fee },
        text: `${pick.why}${whyNotCurrent && !pick.gap ? ` 가진 ${buyRow.name}는 ${whyNotCurrent}${feeGap > 0 ? `(1천만원당 연 약 ${perTenMillion.toLocaleString("ko-KR")}원 차이)` : ""}.` : ""} 새로 사는 돈만 ${to.name}로 보내고, 이미 가진 ${buyRow.name}는 팔지 않고 둡니다.`,
      };
    }
    const heldCodes = new Set(view.holdings.filter((h) => h.accountKey === accountKey).map((h) => h.code));
    feeCompare = [...choice.pool]
      .sort((a, b) => a.fee - b.fee || (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .map((c) => ({
        code: c.code,
        name: c.name,
        fee: c.fee,
        marketCap: c.marketCap,
        return1y: c.return1y,
        deviation: c.deviation,
        held: heldCodes.has(c.code),
        chosen: c.code === pick.chosen.code,
        note: pick.notes.get(c.code) ?? "",
      }));
    feeWhy = pick.why;
  }
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
    const cost = estimateSellCost({ code: h.code, name: h.name, productType: h.productType, etfTaxClass: h.etfTaxClass, amount, gain, taxAdvantaged });
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
      paysDistribution: h.group === "income",
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
    } else if (p > STOCK_LOSS_STOP_PCT) {
      const trigger = Math.ceil(h.avgPrice * (1 + STOCK_TRIM_PCT / 100));
      conditionals.push({ code: h.code, name: h.name, triggerPrice: trigger, price: h.price, shares: half, reason: `평단 +${STOCK_TRIM_PCT}%에 처음 닿으면 절반을 지수로 (C54)` });
    }
  }
  // ①-2 개별주 평단 −15% 이하는 지금 전량 지수로 (C69) — 다른 종목이 아니라 지수로, 같은 날 사므로 시장 노출은 그대로
  for (const h of held) {
    if (h.bucket !== "stock" || !h.avgPrice || sellNote.has(h.code)) continue;
    const p = (h.price / h.avgPrice - 1) * 100;
    if (p > STOCK_LOSS_STOP_PCT || h.quantity <= 0) continue;
    pushSell(h, h.quantity, `개별주 평단 대비 ${signedPct(p)} — 지수로 옮기기 (C69: 계속 보유보다 1년 뒤 대개 더 남았고 큰 추가 손실이 적었다). 줄어든 돈은 이미 평가금에 들어 있어 팔아도 시드는 비용만큼만 줄어듭니다.`, buyTarget);
    sellNote.set(h.code, `손실 ${signedPct(p)} — 전량 지수로 옮기기 (C69)`);
  }

  // ② 겹치는 인컴 합치기 — 이 계좌 것만, 수익 구간이면 지금, 손실 구간이면 평단 회복 시
  const compressMoves: NonNullable<RebalanceReport["compress"]>["moves"] = [];
  for (const m of plan?.merges ?? []) {
    const h = held.find((x) => x.code === m.from.code);
    if (!h) continue;
    const to = held.find((x) => x.code === m.to.code);
    if (m.reason.startsWith("역할별 대표로 압축")) {
      compressMoves.push({
        from: { code: h.code, name: h.name },
        to: { code: m.to.code, name: m.to.name },
        when: inProfit(h) ? "now" : `평단 ${won(h.avgPrice!)} 회복 시`,
        taxedGain: m.taxedGain,
        monthlyIncomeDelta: m.monthlyIncomeDelta,
      });
    }
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
  // ④ 같은 지수(예: 코스피200 일반·TR, 운용사만 다름)의 다른 보유 상품 — 살 곳보다 총보수가 0.05%p 이상 비싸면
  //    수익 구간일 때 팔아 살 곳으로 옮기고(손실 구간이면 평단 회복 시), 차이가 작으면 그대로 두고 더 사지 않는다.
  const sameNote = new Map<string, string>();
  if (buyTarget) {
    const target = buyTarget;
    const targetFee = feeOf(target.code);
    for (const h of held) {
      if (h.group !== "growth" || h.code === target.code || sellNote.has(h.code) || laterNote.has(h.code)) continue;
      if (strategyKey(h.name) !== strategyKey(target.name)) continue;
      const fee = feeOf(h.code);
      const gap = fee != null && targetFee != null ? fee - targetFee : null;
      if (gap == null || gap < FEE_TIE_PP - 1e-9) {
        sameNote.set(h.code, `그대로 둡니다 — ${target.name}와 같은 지수라 더 사지 않고 새 돈은 그쪽으로`);
        continue;
      }
      const perTenMillion = Math.round((gap / 100) * 10_000_000).toLocaleString("ko-KR");
      const why = `같은 지수 · 총보수 ${fee}% → ${targetFee}% (1천만원당 연 약 ${perTenMillion}원)`;
      if (inProfit(h)) {
        pushSell(h, h.quantity, `옮기기: ${why}. 수익 구간이라 지금 옮깁니다(같은 날 팔고 사면 시장 노출은 그대로).`, target);
        sellNote.set(h.code, `전량 팔아 ${target.name}로 옮기기 (보수 ${fee}% → ${targetFee}%)`);
      } else {
        conditionals.push({ code: h.code, name: h.name, triggerPrice: Math.ceil(h.avgPrice!), price: h.price, shares: h.quantity, reason: `평단 회복 시 ${target.name}로 옮기기 (${why})` });
        laterNote.set(h.code, `손실 구간 — 평단 ${won(h.avgPrice!)} 회복 시 ${target.name}로 옮기기`);
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
  if (hold) stopReasons.push("인컴은 금액을 유지하고(사지도 팔지도 않음) 늘리는 건 지수로 하기로 정해 두었습니다");

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
      } else if (sameNote.has(h.code)) {
        actionText = sameNote.get(h.code)!;
      } else if (feeSwitch && h.code === feeSwitch.from.code) {
        actionText = `그대로 둡니다 — 새 돈은 총보수가 낮은 ${feeSwitch.to.name}로`;
      } else if (buyTarget && h.code === buyTarget.code) {
        action = "buy";
        actionText = "매도 대금·분배금·새 돈을 여기로";
      } else if (h.group === "income" && stopReasons.length > 0) {
        action = "stop-add";
        actionText = pnlPct != null && pnlPct < 0 ? "손실 구간 — 팔지 않고, 더 사지도 않습니다" : "더 사지 않습니다 (분배금은 지수로)";
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
        fee: feeOf(h.code),
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
  // 문장은 이 계좌에 해당 종목이 있을 때만 넣는다
  const incomeLines: string[] = [];
  const accountIncomePct = total > 0 ? (incomeValue / total) * 100 : 0;
  const hasDividend = incomeHeld.some((h) => h.bucket === "dividend");
  if (ccValue > 0)
    incomeLines.push(
      `커버드콜은 하락장에서 산 뒤 지수가 반등해도 상승분의 절반~3분의 2만 따라옵니다(블로그 3편, 한국·미국 1세대). 지금 커버드콜을 더 사면 분배금은 늘지만, 회복 구간의 수익을 미리 팔아 두는 것과 같습니다.`,
    );
  if (hasDividend)
    incomeLines.push(
      `고배당이 하락장에서 덜 빠진다는 것도 일관되지 않았습니다(C48). 2022·2026 하락에서는 크게 방어했지만 2018~2020 구간에서는 지수보다 더 빠졌고, 2020년 반등 때 지수 +37%를 고배당은 −5~+6%로 거의 못 따라갔습니다.`,
    );
  if (incomeValue > 0) {
    incomeLines.push(
      `버티는 데 필요한 것은 생활비 현금 흐름입니다. 분배금을 생활비로 쓰지 않는다면, 분배금을 받아서 지수로 보내는 것이 하락장에서 싼 지수를 사는 효과를 그대로 얻는 방법입니다.`,
    );
    if (surplus != null && floor > 0) {
      const src = plan!.income.source === "actual" ? "실제 입금" : "추정";
      incomeLines.push(
        surplus >= 0
          ? `전체 월 인컴 ${money(plan!.income.monthlyNet)}(${src})이 목표 ${money(floor)}를 넘었습니다. 계획대로라면 지금이 인컴 추가매수를 멈출 때입니다.`
          : ccShare > COVERED_CALL_MAX_SHARE_PCT
            ? `전체 월 인컴 ${money(plan!.income.monthlyNet)}(${src})은 목표 ${money(floor)}보다 ${money(-surplus)} 적습니다. 다만 커버드콜이 이미 인컴의 ${ccShare.toFixed(0)}%라, 인컴을 더 채운다면 커버드콜이 아니라 고배당 쪽이 반등을 덜 포기합니다.`
            : `전체 월 인컴 ${money(plan!.income.monthlyNet)}(${src})은 목표 ${money(floor)}보다 ${money(-surplus)} 적습니다. 인컴을 더 채운다면 커버드콜이 인컴의 1/3(지금 ${ccShare.toFixed(0)}%)을 넘지 않게 채웁니다.`,
      );
    }
  }

  const monthlyContribution = Math.max(0, Math.round(input.monthlyContribution ?? 0));
  const fromSells = sells.filter((s) => s.to && buyTarget && s.to.code === buyTarget.code).reduce((s, x) => s + x.net, 0);
  // 이 계좌 예수금 — 분배금·매도 대금이 쌓이는 곳이고 다시 사는 것도 이 계좌 안에서다
  const idleRow = plan?.idleCash?.accounts.find((a) => a.accountKey === acc.key) ?? null;
  const fromCash = buyTarget ? Math.max(0, idleRow?.spendable ?? 0) : 0;
  const buyShares = buyTarget && buyTarget.price > 0 ? Math.floor((fromSells + fromCash) / buyTarget.price) : 0;
  // 지금 팔지 않고 두는 손실 종목(ETF 등) — 지수로 옮기는 손실 개별주는 빼고 센다
  const hasLoss = rows.some((r) => r.pnlPct != null && r.pnlPct < 0 && r.action !== "sell");
  // 손실 개별주를 지수로 옮기는 매도(C69)와 수익 구간 매도를 나눠 말한다
  const lossStockCodes = new Set(held.filter((h) => h.bucket === "stock" && h.avgPrice && (h.price / h.avgPrice - 1) * 100 <= STOCK_LOSS_STOP_PCT).map((h) => h.code));
  const lossStockSells = sells.filter((x) => lossStockCodes.has(x.code));
  const profitSells = sells.filter((x) => !lossStockCodes.has(x.code));
  // hold 현금 목표를 채우는 중이면 분배금·새 돈은 지수가 아니라 현금으로 (할 일 화면과 같은 규칙)
  const cashRule = plan?.cash ?? null;
  const fillingCash = cashRule?.state === "filling" && cashRule.amount > 0;

  // 맨 위 한 줄
  const parts: string[] = [];
  if (market?.drawdown)
    parts.push(`코스피가 최근 고점 대비 ${market.fromHighPct.toFixed(1)}%인 하락 구간${hasLoss ? " — 손실 ETF는 팔지 않습니다" : ""}`);
  if (lossStockSells.length) parts.push(`손실 개별주 ${lossStockSells.length}건 지수로`);
  if (profitSells.length) parts.push(`수익 구간 ${profitSells.length}건 정리 → ${buyTarget ? buyTarget.name : "지수"}`);
  else if (!lossStockSells.length) parts.push("지금 팔 종목은 없습니다(수익 구간에 정리 대상 없음)");
  if (conditionals.length) parts.push(`가격 조건부 ${conditionals.length}건 대기`);
  if (stopReasons.length && incomeValue > 0) parts.push("인컴 추가매수 멈춤");
  if (fillingCash) parts.push(`현금 목표 ${cashRule!.targetPct.toFixed(0)}%까지 분배금은 현금으로`);
  const headline = parts.join(" · ");

  // 실행 순서 — 덧붙이는 말은 그 상황일 때만
  const steps: string[] = [];
  let cashMerged = false;
  if (sells.length) {
    const sellAmount = sells.reduce((s, x) => s + x.amount, 0);
    const extra: string[] = [];
    const many = sells.filter((x) => x.shares >= 10);
    if (many.length) extra.push(`${many.map((x) => x.name).join(", ")}처럼 수량이 많으면 몇 번에 나눠 팔아도 됩니다.`);
    const dist = sells.filter((x) => x.paysDistribution);
    if (dist.length) extra.push(`${dist.map((x) => x.name).join(", ")}은 분배금이 나오는 종목이라, 분배락일 직전이면 분배금을 받은 뒤 팝니다.`);
    if (sellAmount < Math.max(100_000, total * 0.005)) extra.push(`금액이 ${money(sellAmount)}으로 작아 급하지 않습니다. 다음 점검 때 함께 처리해도 됩니다.`);
    const list = (xs: ReportSell[]) => xs.map((x) => `${x.name} ${x.shares.toLocaleString("ko-KR")}주(${money(x.amount)})`).join(", ");
    if (profitSells.length) steps.push(`수익 구간 종목부터 팝니다: ${list(profitSells)}.${extra.length && !lossStockSells.length ? ` ${extra.join(" ")}` : ""}`);
    if (lossStockSells.length)
      steps.push(`평단 −${Math.abs(STOCK_LOSS_STOP_PCT)}% 이하 개별주는 지수로 옮깁니다: ${list(lossStockSells)}. 같은 날 지수를 사므로 하락장에 팔고 반등을 놓치는 것과 다릅니다. 다른 종목으로 갈아타지 않고, 옮긴 뒤 다시 사려고 기다리지 않습니다. 한 번에 옮기는 게 평균으로는 낫지만, 마음이 힘들면 2~3달에 나눠도 됩니다.${extra.length ? ` ${extra.join(" ")}` : ""}`);
    // 옮길 곳별로 묶는다 — 합치기 대금은 남길 인컴 종목으로, 나머지는 지수로
    const byDest = new Map<string, { name: string; price: number; net: number; cash: number }>();
    for (const x of sells) {
      if (!x.to) continue;
      const price = buyTarget && x.to.code === buyTarget.code ? buyTarget.price : held.find((h) => h.code === x.to!.code)?.price ?? 0;
      const d = byDest.get(x.to.code) ?? { name: x.to.name, price, net: 0, cash: 0 };
      d.net += x.net;
      byDest.set(x.to.code, d);
    }
    // 판 대금이 지수로 가면 같은 계좌 예수금(현금 목표 몫 뺀 것)을 합쳐 한 번에 산다
    const toIndex = buyTarget ? byDest.get(buyTarget.code) : undefined;
    if (toIndex && fromCash > 0) {
      toIndex.net += fromCash;
      toIndex.cash = fromCash;
      cashMerged = true;
    }
    const dests = [...byDest.values()].filter((d) => d.price > 0);
    const buyable = dests.filter((d) => d.net >= d.price);
    const short = dests.filter((d) => d.net < d.price);
    const amountText = (d: { net: number; cash: number }) => (d.cash > 0 ? `판 대금 ${money(d.net - d.cash)} + 예수금 ${money(d.cash)}` : money(d.net));
    if (buyable.length)
      steps.push(`판 날 같은 계좌에서 바로 삽니다: ${buyable.map((d) => `${d.name} 약 ${Math.floor(d.net / d.price).toLocaleString("ko-KR")}주(${amountText(d)})`).join(", ")}. 현금으로 들고 기다리지 않습니다.`);
    for (const d of short)
      steps.push(`${d.cash > 0 ? "매도 대금과 예수금을 합친" : "매도 대금"} ${money(d.net)}이 ${d.name} 1주 값(${won(d.price)})보다 작습니다. 현금으로 두었다가 다음 분배금과 합쳐 ${d.name}를 삽니다.`);
  }
  if (idleRow && !cashMerged) {
    const keepText = idleRow.keep > 0 ? ` 현금 목표 몫 ${money(idleRow.keep)}은 두고,` : "";
    const shares = buyTarget && buyTarget.price > 0 ? Math.floor(idleRow.spendable / buyTarget.price) : 0;
    if (idleRow.spendable <= 0) steps.push(`이 계좌 예수금 ${money(idleRow.balance)}은 전체 현금 목표를 채우는 몫이라 그대로 둡니다.`);
    else
      steps.push(
        buyTarget && shares > 0
          ? `이 계좌 예수금 ${money(idleRow.balance)} 중${keepText} 남는 ${money(idleRow.spendable)}으로 ${buyTarget.name} 약 ${shares.toLocaleString("ko-KR")}주(${money(shares * buyTarget.price)})를 삽니다. 이미 계좌에 있는 새 돈이라 기다리지 않습니다.`
          : buyTarget
            ? `이 계좌 예수금 중 쓸 수 있는 ${money(idleRow.spendable)}이 ${buyTarget.name} 1주 값(${won(buyTarget.price)})보다 작습니다. 다음 분배금·새 돈과 합쳐서 삽니다.`
            : `이 계좌 예수금 중 쓸 수 있는 ${money(idleRow.spendable)}은 지수 ETF를 하나 정해 사는 데 씁니다. ${buyHint}`,
      );
  }
  const inflow: string[] = [];
  if (accountMonthlyNet >= 1_000) inflow.push(`분배금(월 약 ${money(accountMonthlyNet)})`);
  if (monthlyContribution > 0) inflow.push(`새 돈(월 ${money(monthlyContribution)})`);
  if (inflow.length)
    steps.push(
      fillingCash && cashRule
        ? `현금 목표 ${cashRule.targetPct.toFixed(0)}%까지 ${money(cashRule.amount)} 남았습니다. 그때까지 ${inflow.join("과 ")}은 사지 말고 계좌에 현금으로 둡니다.${cashRule.months != null ? ` 지금 속도면 약 ${cashRule.months}개월 걸립니다.` : ""} 다 채운 뒤부터 ${buyTarget ? buyTarget.name : "지수 ETF"}로 보냅니다.`
        : buyTarget
        ? `이번 달부터 ${inflow.join("과 ")}이 들어오면 ${buyTarget.name}로 보냅니다.${feeSwitch ? ` ${feeSwitch.text}` : ""}`
        : `${inflow.join("과 ")}을 모아 지수 ETF를 하나 정해 사기 시작합니다. ${buyHint}`,
    );
  else if (!buyTarget) steps.push(`새 돈이 생기면 지수 ETF를 하나 정해 사기 시작합니다. ${buyHint}`);
  // 현금 밴드 규칙(hold) — 판 지수가 이 계좌 것일 때, 넘는 현금은 가장 큰 계좌에서만 안내한다(계좌별로 나뉘어 있지 않다)
  if (cashRule?.state === "take-profit" && cashRule.sellFrom && cashRule.sellFrom.accountLabel === acc.label)
    steps.push(
      `현금이 ${cashRule.actualPct.toFixed(1)}%로 목표 아래 ${cashRule.bandPp.toFixed(0)}%p를 넘게 줄었습니다. ${cashRule.sellFrom.name} ${cashRule.sellFrom.shares.toLocaleString("ko-KR")}주(약 ${money(cashRule.amount)})를 팔아 현금으로 둡니다. 판단이 아니라 비중 규칙입니다.`,
    );
  if (cashRule?.state === "buy-index" && cashRule.amount > 0 && view.accounts[0]?.key === acc.key)
    steps.push(
      `현금이 ${cashRule.actualPct.toFixed(1)}%로 목표보다 ${cashRule.bandPp.toFixed(0)}%p 넘게 많습니다. 넘는 ${money(cashRule.amount)}으로 ${buyTarget ? buyTarget.name : "지수 ETF"}를 삽니다.`,
    );
  if (input.planMixLines?.length) steps.push(planMixLineForAccount(input.planMixLines, accountKey));
  if (stopReasons.length && incomeValue > 0) steps.push(`인컴(커버드콜·배당) 추가매수를 멈춥니다 — ${stopReasons[0]}.`);
  if (conditionals.length)
    steps.push(`가격 조건부 ${conditionals.length}건은 월 1회 점검 때만 봅니다. 조건 가격에 닿은 종목만 실행하고, 매일 확인하지 않습니다.`);
  if (compressMoves.length && plan?.compress)
    steps.push(
      `인컴 종목 압축: 역할별 대표로 ${compressMoves.length}종목을 옮깁니다(인컴 종목 ${plan.compress.before}종 → ${plan.compress.after}종, 목표 ${plan.compress.target}종). 서두를 필요는 없고, 한 번에 하나씩 같은 계좌에서 팔고 바로 사면 됩니다.`,
    );
  const outGroups = view.groups.filter((g) => Math.abs(g.diffPct) > REBALANCE_BAND_PP);
  // 가이드(view.rebalance.needed)와 같은 기준 — 바구니 ±10%p에 더해 성장 안 해외 비중이 ±20%p를 벗어난 경우
  const split = view.growthSplit;
  const splitOff = split.krValue + split.globalValue > 0 && Math.abs(split.globalPct - split.targetGlobalPct) > REBALANCE_BAND_PP * 2;
  const offTexts = [
    ...outGroups.map((g) => `${g.label} ${g.actualPct.toFixed(0)}%(목표 ${g.targetPct.toFixed(0)}%)`),
    ...(splitOff ? [`성장 안 해외 비중 ${split.globalPct.toFixed(0)}%(목표 ${split.targetGlobalPct}%)`] : []),
  ];
  steps.push(
    offTexts.length
      ? `${offTexts.join(", ")}이 목표를 벗어나 있습니다. 새 돈·분배금으로 먼저 맞추고${splitOff ? "(해외 지수는 ISA·연금 계좌에서)" : ""}, 한 달 뒤 점검 때도 벗어나 있으면 수익 구간 종목부터 일부 팔아 맞춥니다. 손실 종목은 이 때문에 팔지 않습니다.${splitOff && split.globalValue === 0 ? " 해외 지수를 둘 계획이 없다면 가이드 설정의 해외 비중을 0으로 바꾸세요." : ""}`
      : `지금은 모든 바구니가 목표 ±${REBALANCE_BAND_PP}%p 안이라, 비중을 맞추려고 팔 것은 없습니다. 다음 점검은 한 달 뒤입니다.`,
  );

  const notes = [
    "안내만 하며 주문하지 않습니다. 수익을 보장하지 않으며, 근거는 과거 자료 검증 결과입니다(판정 등록부 C48·C54, 블로그 3편).",
    "분배율은 네이버 최근 12개월 분배율을 쓰고, 없으면 상품 유형별 가정입니다. 분배금은 매달 같지 않습니다.",
    "매도 비용은 수수료 0.015%, 개별주 거래세 0.20%, 일반 계좌의 기타 ETF(해외주식·채권·금 등) 매매차익 15.4%(과표기준가 대신 매매차익으로 근사)를 뺀 추정입니다.",
    "목표 비중·인컴 하한은 이 계좌가 아니라 입력한 실계좌 전체 기준입니다. 예금·입력하지 않은 계좌는 빠져 있습니다.",
  ];
  if (rows.some((r) => r.avgPrice == null)) notes.push("평균 매수가가 없는 종목은 수익 구간 판단 없이 그대로 둡니다.");

  const stress = buildReportStress(held.map((h) => ({ bucket: h.bucket, name: h.name, value: h.value })));
  const reliability = buildReportReliability({
    rows: held.map((h) => {
      const y = yieldOf(h.code, h.bucket, h.name);
      return { code: h.code, name: h.name, quantity: h.quantity, price: h.price, avgPrice: h.avgPrice ?? null, value: h.value, isIncome: h.group === "income", yieldSource: y.source };
    }),
    accountTotal: total,
    today: view.today,
    realtimeCodes: input.realtimeCodes,
    unpricedNames: input.unpricedNames,
    hasIncomeFloor: floor > 0,
  });
  if (reliability.blockQuantities) notes.push("현재가가 없는 종목이 있어 매매 주수는 확정하지 않은 참고용입니다. 9번 데이터 신뢰도를 먼저 확인하세요.");

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
    feeCompare,
    feeWhy,
    feeSwitch,
    buy: { target: buyTarget, hint: buyHint, fromSells, fromCash, monthlyDistribution: accountMonthlyNet, monthlyContribution, shares: buyShares },
    growth: plan ? { actualPct: plan.growth.actualPct, targetPct: plan.growth.targetPct, needByNewMoney: plan.growth.needByNewMoney, months: plan.growth.months } : null,
    compress: plan?.compress ? { ...plan.compress, moves: compressMoves } : null,
    stress,
    reliability,
    headline,
    steps,
    notes,
  };
}
