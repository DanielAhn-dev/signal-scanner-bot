/**
 * 일일점검 매수 판단 — 보유 종목 추가매수와 신규 종목 진입의 "살지, 몇 주 살지"를 계산만 한다 (DB·API 없음).
 * 판단 결과를 실제 매수(스윕 현금 보충·포지션·거래기록)로 옮기는 일은 호출측(runDailyReviewForUser)이 맡는다.
 *
 * 추가매수 판단 순서: 신호 신뢰도 관문 → 역피라미딩(평단 +3% 미만이면 안 삼) → 사이징(종목 총 목표 − 이미 투입한 금액)
 * 신규 진입 판단 순서: 진입 프로필 분류 → 신호 신뢰도 관문 → 반복 손실 패턴 제외 → 사이징
 */
import {
  resolveAdaptiveAdjustment,
  type AdaptiveAdjustment,
  type AdaptiveConvictionRule,
} from "./adaptiveConvictionService";
import {
  applyDynamicTradeProfileAdjustments,
  classifyAutoTradeEntryProfile,
  resolvePositionTradeProfile,
} from "./virtualAutoTradePositionStrategy";
import { evaluateAutoTradeSignalGate, type SignalGateResult } from "./virtualAutoTradeSignalGate";
import {
  calculateAutoTradeBuySizing,
  resolveConvictionScale,
  type AutoTradeSizingInput,
  type AutoTradeSizingResult,
} from "./virtualAutoTradeSizing";
import type { AutoTradeMarketPolicy } from "./virtualAutoTradeSelection";

/** 평균단가 대비 이만큼 올라 있어야 추가매수한다 — 손실·소폭 상승에서 사면 물타기가 된다 */
export const ADD_ON_MIN_GAIN_PCT = 3;

type ResolvedTradeProfile = ReturnType<typeof resolvePositionTradeProfile>;

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 계좌 전체에 같은 값을 쓰는 사이징 조건 */
export type BuySizingContext = {
  maxPositions: number;
  /** 일손실 한도·최근 성과·시장 레짐에 따른 매수 규모 배율 (곱한 값) */
  riskBudgetScale: number;
  prefs: AutoTradeSizingInput["prefs"];
};

/** 계좌 기본 익절/손절과 분할 매도 횟수 — 포지션 프로필 계산에 쓴다 */
export type ProfileBase = {
  accountStrategy: string | null | undefined;
  baseTakeProfitPct: number;
  baseStopLossPct: number;
  sellSplitCount: number;
};

export type AddOnBuyPlan =
  | { action: "skip"; reason: "add-on-signal-gate-reject"; signalGate: SignalGateResult }
  | { action: "skip"; reason: "add-on-anti-pyramiding"; addOnPnlPct: number }
  /** 예산이 최소 주문액 미만이거나 1주도 못 사는 경우 — 조용히 넘긴다 */
  | { action: "skip"; reason: "add-on-below-min-order" }
  | {
      action: "buy";
      quantity: number;
      minOrderAmount: number;
      currentQty: number;
      currentInvested: number;
      holdingProfile: ResolvedTradeProfile;
      signalGate: SignalGateResult;
    };

export function planAddOnBuy(input: {
  holding: { quantity: number | null; buy_price: number | null; invested_amount: number | null; memo?: string | null };
  candidate: { score: number; isSectorLeader?: boolean | null };
  executionPrice: number;
  factors: Record<string, unknown> | null;
  minTrustScore: number;
  profileBase: ProfileBase;
  adaptiveRule: AdaptiveConvictionRule | null;
  /** 현금 하한을 지킨 뒤 매수에 쓸 수 있는 금액 (스윕 평가액 포함) */
  deployableCash: number;
  currentHoldingCount: number;
  sizingContext: BuySizingContext;
}): AddOnBuyPlan {
  const { holding, candidate, executionPrice } = input;
  const signalGate = evaluateAutoTradeSignalGate({
    currentPrice: executionPrice,
    score: candidate.score,
    factors: input.factors,
    minTrustScore: input.minTrustScore,
    requireAboveSma200: true,
  });
  if (!signalGate.passed) return { action: "skip", reason: "add-on-signal-gate-reject", signalGate };

  const currentQty = Math.max(0, Math.floor(toNumber(holding.quantity, 0)));
  const currentBuyPrice = Math.max(0, toNumber(holding.buy_price, 0));
  const currentInvested = Math.max(0, toNumber(holding.invested_amount, currentQty * currentBuyPrice));
  const addOnPnlPct = currentBuyPrice > 0 ? ((executionPrice - currentBuyPrice) / currentBuyPrice) * 100 : 0;
  if (addOnPnlPct < ADD_ON_MIN_GAIN_PCT) return { action: "skip", reason: "add-on-anti-pyramiding", addOnPnlPct };

  const holdingProfile = resolvePositionTradeProfile({
    accountStrategy: input.profileBase.accountStrategy,
    positionMemo: holding.memo,
    baseTakeProfitPct: input.profileBase.baseTakeProfitPct,
    baseStopLossPct: input.profileBase.baseStopLossPct,
    sellSplitCount: input.profileBase.sellSplitCount,
  });
  // 적응형 피드백: 추매는 기존 보유 관리이므로 제외 없이 확신도 가감만 반영
  const adaptive = resolveAdaptiveAdjustment(input.adaptiveRule, {
    score: candidate.score,
    trustGrade: signalGate.grade,
    profile: holdingProfile.profile,
  });
  const sizing = calculateAutoTradeBuySizing({
    availableCash: input.deployableCash,
    price: executionPrice,
    slotsLeft: 1,
    // 이 종목은 이미 보유 중이므로 "나머지 보유 수"로 센다
    currentHoldingCount: Math.max(0, input.currentHoldingCount - 1),
    maxPositions: Math.max(1, input.sizingContext.maxPositions),
    stopLossPct: holdingProfile.stopLossPct,
    riskBudgetScale: input.sizingContext.riskBudgetScale,
    conviction: resolveConvictionScale({
      score: candidate.score,
      trustGrade: signalGate.grade,
      isSectorLeader: candidate.isSectorLeader ?? undefined,
      adaptiveDelta: adaptive.delta,
    }),
    prefs: input.sizingContext.prefs,
  });
  // 종목 총 목표 예산에서 이미 투입한 금액을 뺀 만큼만 더 산다
  const budget = Math.max(0, Math.min(sizing.budget, sizing.totalBudget - currentInvested));
  if (budget > 0 && budget < sizing.minOrderAmount) return { action: "skip", reason: "add-on-below-min-order" };
  const quantity = Math.max(0, Math.floor(budget / executionPrice));
  if (quantity <= 0) return { action: "skip", reason: "add-on-below-min-order" };

  return {
    action: "buy",
    quantity,
    minOrderAmount: sizing.minOrderAmount,
    currentQty,
    currentInvested,
    holdingProfile,
    signalGate,
  };
}

/**
 * 순수 현금(스윕 보충 후)으로 살 수 있는 만큼으로 수량을 줄인다. 줄인 뒤 최소 주문액 미만이면 0.
 * @param cashBuffer 수수료·슬리피지 여유 배율 (BUY_CASH_BUFFER)
 */
export function capQuantityToCash(input: {
  quantity: number;
  availableCash: number;
  price: number;
  minOrderAmount: number;
  cashBuffer: number;
}): number {
  const cashCapQty = Math.floor(input.availableCash / (input.price * input.cashBuffer));
  if (input.quantity <= cashCapQty) return input.quantity;
  if (cashCapQty <= 0 || cashCapQty * input.price < input.minOrderAmount) return 0;
  return cashCapQty;
}

/** 추가매수 후 포지션 (수량·원금·평균단가) */
export function computeAddOnPosition(input: {
  currentQty: number;
  currentInvested: number;
  addQty: number;
  price: number;
}): { addInvested: number; nextQty: number; nextInvested: number; nextBuyPrice: number } {
  const addInvested = Math.round(input.addQty * input.price);
  const nextQty = input.currentQty + input.addQty;
  const nextInvested = input.currentInvested + addInvested;
  return { addInvested, nextQty, nextInvested, nextBuyPrice: Number((nextInvested / nextQty).toFixed(4)) };
}

export type NewEntryCandidate = {
  code: string;
  score: number;
  signal?: string | null;
  rsi14?: number | null;
  liquidity?: number | null;
  stableTurn?: string | null;
  stableTrust?: number | null;
  isSectorLeader?: boolean | null;
} & Parameters<typeof classifyAutoTradeEntryProfile>[0]["candidate"];

export type NewEntryPlan =
  | { action: "skip"; reason: "signal-gate-reject"; signalGate: SignalGateResult }
  | {
      action: "skip";
      reason: "adaptive-pattern-exclude";
      signalGate: SignalGateResult;
      adaptive: AdaptiveAdjustment;
    }
  | {
      action: "size";
      /**
       * 진입 프로필 기본값 — 월요일·일일점검 모두 안내 문구·따라하기 주문의 익절/손절에 쓴다.
       * 보유 중 매도 판단도 포지션 메모의 프로필 이름으로 이 기본값을 다시 계산하므로 둘이 맞는다.
       */
      baseProfile: ResolvedTradeProfile;
      /** 종목 상황(점수·신호·유동성 등)으로 조정한 프로필 — 사이징 손절폭·예정 검토일에 쓴다 */
      profile: ResolvedTradeProfile;
      signalGate: SignalGateResult;
      adaptive: AdaptiveAdjustment;
      /** 주어진 투자 가능 금액으로 사이징한다 (스윕 보충 뒤 순수 현금 기준으로 다시 부를 수 있게) */
      size: (deployableCash: number) => AutoTradeSizingResult;
    };

/**
 * 신규 종목 진입 판단 (월요일 매수·일일점검 신규 매수 공통). 통과하면 사이징 함수를 돌려준다
 * (수량 0이면 호출측이 현금 부족으로 처리). 건너뛴 이유는 호출측이 경로별 로그 이름으로 바꿔 남긴다.
 */
export function planNewEntry(input: {
  candidate: NewEntryCandidate;
  executionPrice: number;
  factors: Record<string, unknown> | null;
  newsBias: "risk-on" | "neutral" | "risk-off" | null;
  riskProfile: string | null | undefined;
  marketPolicy: Pick<AutoTradeMarketPolicy, "mode">;
  minTrustScore: number;
  profileBase: ProfileBase;
  adaptiveRule: AdaptiveConvictionRule | null;
  slotsLeft: number;
  plannedHoldingCount: number;
  sizingContext: BuySizingContext;
  /**
   * 사이징의 손절폭(손실 한도 예산 계산용). 기본은 조정한 프로필의 손절폭.
   * 월요일 매수는 계좌 기본 손절폭을 쓴다 (예전부터의 동작 — 두 경로가 다른 이유는 기록에 없다).
   */
  sizingStopLossPct?: number;
}): NewEntryPlan {
  const { candidate, marketPolicy } = input;
  const candidateProfile = classifyAutoTradeEntryProfile({
    accountStrategy: input.profileBase.accountStrategy,
    riskProfile: input.riskProfile,
    marketMode: marketPolicy.mode,
    newsBias: input.newsBias,
    candidate: { ...candidate, stableTurn: candidate.stableTurn ?? null, stableTrust: candidate.stableTrust ?? null },
  });
  const baseProfile = resolvePositionTradeProfile({
    accountStrategy: candidateProfile,
    baseTakeProfitPct: input.profileBase.baseTakeProfitPct,
    baseStopLossPct: input.profileBase.baseStopLossPct,
    sellSplitCount: input.profileBase.sellSplitCount,
  });
  const profile = applyDynamicTradeProfileAdjustments({
    tradeProfile: baseProfile,
    context: {
      score: candidate.score,
      signal: candidate.signal,
      rsi14: candidate.rsi14,
      liquidity: candidate.liquidity,
      stableTurn: candidate.stableTurn,
      stableTrust: candidate.stableTrust,
      marketMode: marketPolicy.mode,
      isSectorLeader: candidate.isSectorLeader,
    },
  });

  const signalGate = evaluateAutoTradeSignalGate({
    currentPrice: input.executionPrice,
    score: candidate.score,
    factors: input.factors,
    minTrustScore: input.minTrustScore,
    requireAboveSma200: true,
  });
  if (!signalGate.passed) return { action: "skip", reason: "signal-gate-reject", signalGate };

  // 적응형 피드백: 신규 진입이므로 반복 손실 패턴은 제외
  const adaptive = resolveAdaptiveAdjustment(input.adaptiveRule, {
    score: candidate.score,
    trustGrade: signalGate.grade,
    profile: profile.profile,
  });
  if (adaptive.excluded) {
    return { action: "skip", reason: "adaptive-pattern-exclude", signalGate, adaptive };
  }

  const conviction = resolveConvictionScale({
    score: candidate.score,
    trustGrade: signalGate.grade,
    isSectorLeader: candidate.isSectorLeader ?? undefined,
    adaptiveDelta: adaptive.delta,
  });
  const size = (deployableCash: number) =>
    calculateAutoTradeBuySizing({
      availableCash: deployableCash,
      price: input.executionPrice,
      slotsLeft: input.slotsLeft,
      currentHoldingCount: input.plannedHoldingCount,
      maxPositions: input.sizingContext.maxPositions,
      stopLossPct: input.sizingStopLossPct ?? profile.stopLossPct,
      riskBudgetScale: input.sizingContext.riskBudgetScale,
      conviction,
      prefs: input.sizingContext.prefs,
    });
  return { action: "size", baseProfile, profile, signalGate, adaptive, size };
}
