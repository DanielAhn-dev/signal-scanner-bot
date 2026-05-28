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