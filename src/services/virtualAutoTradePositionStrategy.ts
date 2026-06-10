import { buildStrategyMemo } from "../lib/strategyMemo";

export type PositionStrategyProfile =
  | "DEFAULT"
  | "HOLD_SAFE"
  | "REDUCE_TIGHT"
  | "WAIT_AND_DIP_BUY"
  | "SHORT_SWING"
  | "SWING"
  | "POSITION_CORE";

export type PositionBucket = "LONG" | "SWING";

export type ParsedPositionStrategyState = {
  profile: PositionStrategyProfile;
  takeProfitTranchesDone: number;
  /** 보유 기간 중 최고가 (트레일링 스탑 계산용, memo에서 복원) */
  peakPrice: number | null;
};

export type ResolvedPositionTradeProfile = {
  profile: PositionStrategyProfile;
  takeProfitPct: number;
  stopLossPct: number;
  takeProfitSplitCount: number;
  allowAddOn: boolean;
  blockNewBuy: boolean;
  expectedHorizonDays: number;
};

export type EntryProfileCandidate = {
  score: number;
  signal?: string | null;
  rsi14?: number | null;
  liquidity?: number | null;
  stableTurn?: string | null;
  stableTrust?: number | null;
};

export type DynamicTradeProfileContext = EntryProfileCandidate & {
  marketMode?: "large-cap-defense" | "balanced" | "rotation" | null;
  isSectorLeader?: boolean | null;
};

export type PlannedAutoTradeExit =
  | {
      action: "HOLD";
      quantityToSell: 0;
      isPartial: false;
      nextTakeProfitTranchesDone: number;
      reason: "within-range";
    }
  | {
      action: "STOP_LOSS";
      quantityToSell: number;
      isPartial: false;
      nextTakeProfitTranchesDone: number;
      reason: "stop-loss";
    }
  | {
      action: "TAKE_PROFIT";
      quantityToSell: number;
      isPartial: boolean;
      nextTakeProfitTranchesDone: number;
      reason: "take-profit-partial" | "take-profit-final";
    }
  | {
      action: "OVERWEIGHT_REDUCTION";
      quantityToSell: number;
      isPartial: true;
      nextTakeProfitTranchesDone: number;
      reason: "overweight-reduction";
      /** 매도 후 예상 비중 % */
      targetWeightPct: number;
    }
  | {
      action: "SECTOR_ROTATION";
      quantityToSell: number;
      isPartial: boolean;
      nextTakeProfitTranchesDone: number;
      reason: "sector-rotation";
      /** 매도 시점 섹터 등급 */
      sectorGrade: "C";
    };

const VALID_PROFILES = new Set<PositionStrategyProfile>([
  "DEFAULT",
  "HOLD_SAFE",
  "REDUCE_TIGHT",
  "WAIT_AND_DIP_BUY",
  "SHORT_SWING",
  "SWING",
  "POSITION_CORE",
]);

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Math.floor(toNumber(value, fallback));
  return n > 0 ? n : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function sanitizeMemoValue(value: string): string {
  return String(value).replace(/[;\n\r]/g, " ").trim();
}

function normalizeSignal(signal: unknown): string {
  return String(signal ?? "").trim().toUpperCase();
}

function parseMemoMap(raw?: string | null): Map<string, string> {
  const memo = String(raw ?? "").trim();
  const map = new Map<string, string>();

  if (!memo) return map;

  for (const token of memo.split(";")) {
    const [key, ...rest] = token.split("=");
    const normalizedKey = String(key ?? "").trim().toLowerCase();
    const value = rest.join("=").trim();
    if (!normalizedKey || !value) continue;
    map.set(normalizedKey, value);
  }

  return map;
}

export function normalizePositionStrategyProfile(
  value?: string | null
): PositionStrategyProfile {
  const normalized = String(value ?? "DEFAULT").trim().toUpperCase();
  return VALID_PROFILES.has(normalized as PositionStrategyProfile)
    ? (normalized as PositionStrategyProfile)
    : "DEFAULT";
}

export function parsePositionStrategyState(
  memo?: string | null,
  fallbackProfile?: string | null
): ParsedPositionStrategyState {
  const map = parseMemoMap(memo);
  const profile = normalizePositionStrategyProfile(
    map.get("profile") ?? map.get("strategy_profile") ?? fallbackProfile ?? "DEFAULT"
  );
  const takeProfitTranchesDone = Math.max(0, Math.floor(toNumber(map.get("tp_tranches"), 0)));
  const rawPeak = toNumber(map.get("peak_price"), 0);
  const peakPrice = rawPeak > 0 ? rawPeak : null;

  return {
    profile,
    takeProfitTranchesDone,
    peakPrice,
  };
}

export function buildPositionStrategyMemo(input: {
  event: string;
  note?: string;
  profile?: string | null;
  takeProfitTranchesDone?: number;
  /** 보유 중 최고가 (트레일링 스탑용) */
  peakPrice?: number | null;
}): string {
  const profile = normalizePositionStrategyProfile(input.profile);
  const takeProfitTranchesDone = Math.max(0, Math.floor(toNumber(input.takeProfitTranchesDone, 0)));
  const peakPriceVal = input.peakPrice != null && input.peakPrice > 0 ? Math.round(input.peakPrice) : null;
  const parts = [
    buildStrategyMemo({
      strategyId: "core.autotrade.v1",
      event: input.event,
      note: input.note,
    }),
    `profile=${sanitizeMemoValue(profile)}`,
    `tp_tranches=${takeProfitTranchesDone}`,
  ];
  if (peakPriceVal != null) parts.push(`peak_price=${peakPriceVal}`);

  return parts.join(";");
}

export function classifyAutoTradeEntryProfile(input: {
  accountStrategy?: string | null;
  riskProfile?: string | null;
  marketMode?: "large-cap-defense" | "balanced" | "rotation" | null;
  newsBias?: "risk-on" | "neutral" | "risk-off" | null;
  candidate: EntryProfileCandidate;
}): PositionStrategyProfile {
  const fixedAccountProfile = normalizePositionStrategyProfile(input.accountStrategy);
  if (
    fixedAccountProfile === "SHORT_SWING" ||
    fixedAccountProfile === "SWING" ||
    fixedAccountProfile === "POSITION_CORE"
  ) {
    return fixedAccountProfile;
  }

  const signal = normalizeSignal(input.candidate.signal);
  const score = toNumber(input.candidate.score, 0);
  const rsi14 = toNumber(input.candidate.rsi14, 50);
  const liquidity = toNumber(input.candidate.liquidity, 0);
  const stableTurn = String(input.candidate.stableTurn ?? "").trim().toLowerCase();
  const stableTrust = toNumber(input.candidate.stableTrust, 0);
  const accountStrategy = normalizePositionStrategyProfile(input.accountStrategy);
  const riskProfile = String(input.riskProfile ?? "").trim().toLowerCase();
  const marketMode = String(input.marketMode ?? "balanced").trim().toLowerCase();
  const newsBias = String(input.newsBias ?? "neutral").trim().toLowerCase();

  const strongSignal = signal === "BUY" || signal === "STRONG_BUY";
  const preferredSignal = strongSignal || signal === "WATCH";
  const calmRsi = rsi14 >= 45 && rsi14 <= 60;
  const healthyRsi = rsi14 >= 42 && rsi14 <= 68;
  const highLiquidity = liquidity <= 0 || liquidity >= 15_000_000_000;
  const stableBull = stableTurn === "bull-weak" || stableTurn === "bull-strong";
  const stableBear = stableTurn === "bear-weak" || stableTurn === "bear-strong";
  const strongTrust = stableTrust >= 70;
  const conservativeBias = accountStrategy === "HOLD_SAFE" || riskProfile === "safe";
  const defensiveBias = conservativeBias || accountStrategy === "REDUCE_TIGHT";
  const aggressiveBias = riskProfile === "active";
  const macroDefensive = marketMode === "large-cap-defense";
  const macroAggressive = marketMode === "rotation";
  const newsDefensive = newsBias === "risk-off";
  const newsSupportive = newsBias === "risk-on";

  if (macroDefensive || newsDefensive || stableBear) {
    if (score >= 78 && strongSignal && highLiquidity && !stableBear) {
      return "SWING";
    }
    return "SHORT_SWING";
  }

  if (conservativeBias && score >= 82 && strongSignal && calmRsi && highLiquidity && !stableBear) {
    return "POSITION_CORE";
  }

  if (score >= 82 && strongSignal && calmRsi && highLiquidity && (macroAggressive || newsSupportive || strongTrust || stableBull)) {
    return aggressiveBias ? "SWING" : "POSITION_CORE";
  }

  if (score >= 72 && preferredSignal && healthyRsi) {
    return conservativeBias ? "SWING" : aggressiveBias ? "SHORT_SWING" : "SWING";
  }

  if (score >= 62 && (preferredSignal || calmRsi)) {
    return defensiveBias ? "SWING" : "SHORT_SWING";
  }

  return defensiveBias ? "DEFAULT" : "SHORT_SWING";
}

export function resolvePositionTradeProfile(input: {
  accountStrategy?: string | null;
  positionMemo?: string | null;
  baseTakeProfitPct: number;
  baseStopLossPct: number;
  sellSplitCount: number;
}): ResolvedPositionTradeProfile {
  const state = parsePositionStrategyState(input.positionMemo, input.accountStrategy);
  const baseTakeProfitPct = Math.abs(toNumber(input.baseTakeProfitPct, 8));
  const baseStopLossPct = Math.abs(toNumber(input.baseStopLossPct, 4));
  const sellSplitCount = clampInt(toPositiveInt(input.sellSplitCount, 2), 1, 4);

  switch (state.profile) {
    case "HOLD_SAFE":
      return {
        profile: state.profile,
        takeProfitPct: Math.max(4, Math.min(baseTakeProfitPct, 8)),
        stopLossPct: Math.max(2, Math.min(baseStopLossPct, 3)),
        takeProfitSplitCount: Math.max(2, sellSplitCount),
        allowAddOn: true,
        blockNewBuy: false,
        expectedHorizonDays: 10,
      };
    case "REDUCE_TIGHT":
      return {
        profile: state.profile,
        takeProfitPct: 4,
        stopLossPct: 2,
        takeProfitSplitCount: 1,
        allowAddOn: false,
        blockNewBuy: false,
        expectedHorizonDays: 3,
      };
    case "WAIT_AND_DIP_BUY":
      return {
        profile: state.profile,
        takeProfitPct: Math.max(5, baseTakeProfitPct),
        stopLossPct: baseStopLossPct,
        takeProfitSplitCount: Math.max(2, sellSplitCount),
        allowAddOn: false,
        blockNewBuy: true,
        expectedHorizonDays: 7,
      };
    case "SHORT_SWING":
      return {
        profile: state.profile,
        takeProfitPct: 5,
        stopLossPct: 2.5,
        takeProfitSplitCount: Math.max(2, Math.min(sellSplitCount, 2)),
        allowAddOn: false,
        blockNewBuy: false,
        expectedHorizonDays: 3,
      };
    case "POSITION_CORE":
      return {
        profile: state.profile,
        takeProfitPct: Math.max(10, baseTakeProfitPct),
        stopLossPct: Math.max(3, baseStopLossPct),
        takeProfitSplitCount: Math.max(2, Math.min(4, sellSplitCount + 1)),
        allowAddOn: true,
        blockNewBuy: false,
        expectedHorizonDays: 20,
      };
    case "SWING":
      return {
        profile: state.profile,
        takeProfitPct: Math.max(7, baseTakeProfitPct),
        stopLossPct: Math.max(3, baseStopLossPct),
        takeProfitSplitCount: Math.max(2, sellSplitCount),
        allowAddOn: true,
        blockNewBuy: false,
        expectedHorizonDays: 7,
      };
    default:
      return {
        profile: "DEFAULT",
        takeProfitPct: baseTakeProfitPct,
        stopLossPct: baseStopLossPct,
        takeProfitSplitCount: sellSplitCount,
        allowAddOn: true,
        blockNewBuy: false,
        expectedHorizonDays: 5,
      };
  }
}

export function applyDynamicTradeProfileAdjustments(input: {
  tradeProfile: ResolvedPositionTradeProfile;
  context: DynamicTradeProfileContext;
}): ResolvedPositionTradeProfile {
  const profile = input.tradeProfile;
  const score = toNumber(input.context.score, 0);
  const stableTrust = toNumber(input.context.stableTrust, 0);
  const rsi14 = toNumber(input.context.rsi14, 50);
  const liquidity = toNumber(input.context.liquidity, 0);
  const signal = normalizeSignal(input.context.signal);
  const stableTurn = String(input.context.stableTurn ?? "").trim().toLowerCase();
  const marketMode = String(input.context.marketMode ?? "balanced").trim().toLowerCase();
  const isSectorLeader = Boolean(input.context.isSectorLeader);

  let takeProfitAdj = 0;
  let stopLossAdj = 0;
  let horizonAdj = 0;

  const strongSetup =
    score >= 82 &&
    stableTrust >= 70 &&
    (signal === "BUY" || signal === "STRONG_BUY") &&
    (stableTurn === "bull-weak" || stableTurn === "bull-strong");

  if (score >= 85) {
    takeProfitAdj += 1.2;
    horizonAdj += 3;
  } else if (score <= 66) {
    takeProfitAdj -= 0.8;
    horizonAdj -= 1;
  }

  if (stableTrust >= 75) {
    takeProfitAdj += 1.0;
    horizonAdj += 2;
  } else if (stableTrust > 0 && stableTrust < 55) {
    takeProfitAdj -= 0.7;
  }

  if (stableTurn === "bull-strong") {
    takeProfitAdj += 1.0;
    horizonAdj += 3;
  } else if (stableTurn === "bear-strong") {
    takeProfitAdj -= 1.4;
    horizonAdj -= 3;
    stopLossAdj -= 0.4;
  }

  if (liquidity > 0 && liquidity < 5_000_000_000) {
    takeProfitAdj -= 1.0;
    horizonAdj -= 2;
    stopLossAdj -= 0.3;
  } else if (liquidity >= 30_000_000_000) {
    takeProfitAdj += 0.6;
  }

  if (rsi14 >= 45 && rsi14 <= 62) {
    takeProfitAdj += 0.3;
  } else if (rsi14 >= 72) {
    takeProfitAdj -= 0.6;
    horizonAdj -= 1;
  }

  if (marketMode === "large-cap-defense") {
    takeProfitAdj -= 1.0;
    horizonAdj -= 2;
  } else if (marketMode === "rotation") {
    takeProfitAdj += 0.4;
  }

  if (isSectorLeader) {
    takeProfitAdj += 0.7;
    horizonAdj += 2;
  }

  if (strongSetup && profile.profile === "POSITION_CORE") {
    takeProfitAdj += 1.3;
    horizonAdj += 5;
    stopLossAdj += 0.5;
  }

  const takeProfitPct = Number(
    Math.max(3.5, Math.min(22, profile.takeProfitPct + takeProfitAdj)).toFixed(2)
  );
  const stopLossPct = Number(
    Math.max(2, Math.min(12, profile.stopLossPct + stopLossAdj)).toFixed(2)
  );
  const expectedHorizonDays = clampInt(profile.expectedHorizonDays + horizonAdj, 3, 45);
  const takeProfitSplitCount = strongSetup
    ? Math.min(4, Math.max(profile.takeProfitSplitCount, 3))
    : profile.takeProfitSplitCount;

  return {
    ...profile,
    takeProfitPct,
    stopLossPct,
    expectedHorizonDays,
    takeProfitSplitCount,
  };
}

export function resolvePositionBucketFromProfile(
  profile?: string | null
): PositionBucket {
  const normalized = normalizePositionStrategyProfile(profile);
  return normalized === "POSITION_CORE" ? "LONG" : "SWING";
}

export function planAutoTradeExit(input: {
  quantity: number;
  pnlPct: number;
  takeProfitPct: number;
  stopLossPct: number;
  takeProfitSplitCount: number;
  takeProfitTranchesDone: number;
}): PlannedAutoTradeExit {
  const quantity = Math.max(0, Math.floor(toNumber(input.quantity, 0)));
  const pnlPct = toNumber(input.pnlPct, 0);
  const takeProfitPct = Math.abs(toNumber(input.takeProfitPct, 8));
  const stopLossPct = Math.abs(toNumber(input.stopLossPct, 4));
  const takeProfitSplitCount = clampInt(toPositiveInt(input.takeProfitSplitCount, 2), 1, 4);
  const takeProfitTranchesDone = Math.max(0, Math.floor(toNumber(input.takeProfitTranchesDone, 0)));

  if (quantity <= 0) {
    return {
      action: "HOLD",
      quantityToSell: 0,
      isPartial: false,
      nextTakeProfitTranchesDone: takeProfitTranchesDone,
      reason: "within-range",
    };
  }

  // 경직 손절: 사용자 설정과 무관하게 큰 손실에서 반드시 청산
  // -10% 초과 → 전량 즉시 청산 (파국적 손실 방지)
  if (pnlPct <= -10) {
    return {
      action: "STOP_LOSS",
      quantityToSell: quantity,
      isPartial: false,
      nextTakeProfitTranchesDone: takeProfitTranchesDone,
      reason: "stop-loss",
    };
  }
  // -7% 초과 → 절반 청산 (손실 한정 + 추가 하락 여지 확보)
  if (pnlPct <= -7) {
    const halfQty = Math.max(1, Math.ceil(quantity / 2));
    return {
      action: "TAKE_PROFIT",
      quantityToSell: halfQty,
      isPartial: halfQty < quantity,
      nextTakeProfitTranchesDone: takeProfitTranchesDone,
      reason: "take-profit-partial",
    };
  }

  if (pnlPct <= -stopLossPct) {
    return {
      action: "STOP_LOSS",
      quantityToSell: quantity,
      isPartial: false,
      nextTakeProfitTranchesDone: takeProfitTranchesDone,
      reason: "stop-loss",
    };
  }

  if (pnlPct < takeProfitPct) {
    return {
      action: "HOLD",
      quantityToSell: 0,
      isPartial: false,
      nextTakeProfitTranchesDone: takeProfitTranchesDone,
      reason: "within-range",
    };
  }

  if (quantity === 1 || takeProfitSplitCount <= 1) {
    return {
      action: "TAKE_PROFIT",
      quantityToSell: quantity,
      isPartial: false,
      nextTakeProfitTranchesDone: takeProfitTranchesDone,
      reason: "take-profit-final",
    };
  }

  const normalizedTranchesDone = clampInt(
    takeProfitTranchesDone,
    0,
    Math.max(0, takeProfitSplitCount - 1)
  );
  const remainingTranches = Math.max(1, takeProfitSplitCount - normalizedTranchesDone);
  const quantityToSell = Math.min(quantity, Math.max(1, Math.ceil(quantity / remainingTranches)));
  const nextTakeProfitTranchesDone = normalizedTranchesDone + 1;
  const isFinal = nextTakeProfitTranchesDone >= takeProfitSplitCount || quantityToSell >= quantity;

  return {
    action: "TAKE_PROFIT",
    quantityToSell: isFinal ? quantity : quantityToSell,
    isPartial: !isFinal,
    nextTakeProfitTranchesDone: isFinal ? normalizedTranchesDone : nextTakeProfitTranchesDone,
    reason: isFinal ? "take-profit-final" : "take-profit-partial",
  };
}

/**
 * 비중 초과 감지 시 분할 매도 계획 수립.
 * 한 번에 전량 매도하지 않고 초과분의 절반씩 나눠서 매도한다.
 * targetWeightPct까지 줄이는 데 필요한 수량을 계산한다.
 *
 * @param currentWeightPct - 현재 포지션 비중 (%)
 * @param maxWeightPct - 허용 최대 비중 (%)
 * @param targetWeightPct - 매도 후 목표 비중 (%)
 * @param quantity - 현재 보유 수량
 * @param currentPrice - 현재가
 * @param totalPortfolioValue - 포트폴리오 총 평가액
 * @param takeProfitTranchesDone - 기존 트랜치 진행 수 (HOLD 시 그대로 유지)
 */
export function planOverweightReduction(input: {
  currentWeightPct: number;
  maxWeightPct: number;
  targetWeightPct: number;
  quantity: number;
  currentPrice: number;
  totalPortfolioValue: number;
  takeProfitTranchesDone: number;
}): PlannedAutoTradeExit {
  const {
    currentWeightPct,
    maxWeightPct,
    targetWeightPct,
    quantity,
    currentPrice,
    totalPortfolioValue,
    takeProfitTranchesDone,
  } = input;

  if (currentWeightPct <= maxWeightPct || quantity <= 0 || currentPrice <= 0 || totalPortfolioValue <= 0) {
    return {
      action: "HOLD",
      quantityToSell: 0,
      isPartial: false,
      nextTakeProfitTranchesDone: takeProfitTranchesDone,
      reason: "within-range",
    };
  }

  const targetValue = (targetWeightPct / 100) * totalPortfolioValue;
  const currentValue = currentPrice * quantity;
  const excessValue = currentValue - targetValue;

  if (excessValue <= 0) {
    return {
      action: "HOLD",
      quantityToSell: 0,
      isPartial: false,
      nextTakeProfitTranchesDone: takeProfitTranchesDone,
      reason: "within-range",
    };
  }

  // 초과분의 절반씩 분할 매도 (너무 급격한 청산 방지)
  const sellValue = excessValue / 2;
  const rawQtyToSell = Math.floor(sellValue / currentPrice);
  const quantityToSell = Math.max(1, Math.min(rawQtyToSell, quantity - 1)); // 최소 1주 유지
  const remainingQty = quantity - quantityToSell;
  const remainingValue = remainingQty * currentPrice;
  const afterWeightPct = Number(((remainingValue / totalPortfolioValue) * 100).toFixed(1));

  return {
    action: "OVERWEIGHT_REDUCTION",
    quantityToSell,
    isPartial: true,
    nextTakeProfitTranchesDone: takeProfitTranchesDone,
    reason: "overweight-reduction",
    targetWeightPct: afterWeightPct,
  };
}

export type TimeStopResult =
  | { triggered: false }
  | {
      triggered: true;
      /** "partial": 50% 매도, "full": 전량 매도 */
      phase: "partial" | "full";
      quantityToSell: number;
      holdingDays: number;
      reason: string;
    };

/**
 * 시간 기반 손절(Time-Stop).
 * 손실 구간에서 일정 기간 이상 방치된 포지션을 단계적으로 정리한다.
 *
 * Phase 1 (30일 초과 + -10% 이하): 50% 분할 매도
 * Phase 2 (45일 초과 + -10% 이하): 나머지 전량 매도
 *
 * 수익 중인 종목에는 적용하지 않는다.
 */
export function evaluateTimeStop(input: {
  quantity: number;
  pnlPct: number;
  buyDate: string | null | undefined;
  now?: Date;
}): TimeStopResult {
  const { quantity, pnlPct } = input;
  if (quantity <= 0 || pnlPct >= 0) return { triggered: false };

  const now = input.now ?? new Date();
  const rawDate = String(input.buyDate ?? "").trim();
  if (!rawDate) return { triggered: false };

  const buyTs = Date.parse(rawDate);
  if (!Number.isFinite(buyTs)) return { triggered: false };

  const holdingDays = Math.floor((now.getTime() - buyTs) / (24 * 60 * 60 * 1000));

  const PHASE1_DAYS = 30;
  const PHASE2_DAYS = 45;
  const LOSS_THRESHOLD_PCT = -10;

  if (pnlPct > LOSS_THRESHOLD_PCT) return { triggered: false };

  if (holdingDays >= PHASE2_DAYS) {
    return {
      triggered: true,
      phase: "full",
      quantityToSell: quantity,
      holdingDays,
      reason: `보유 ${holdingDays}일 초과 + 손실 ${pnlPct.toFixed(1)}% → 전량 시간손절`,
    };
  }

  if (holdingDays >= PHASE1_DAYS) {
    const quantityToSell = Math.max(1, Math.floor(quantity / 2));
    return {
      triggered: true,
      phase: "partial",
      quantityToSell,
      holdingDays,
      reason: `보유 ${holdingDays}일 초과 + 손실 ${pnlPct.toFixed(1)}% → 절반 시간손절`,
    };
  }

  return { triggered: false };
}