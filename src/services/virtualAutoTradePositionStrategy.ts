import { buildStrategyMemo } from "../lib/strategyMemo";

export type PositionStrategyProfile =
  | "DEFAULT"
  | "HOLD_SAFE"
  | "REDUCE_TIGHT"
  | "WAIT_AND_DIP_BUY"
  | "SHORT_SWING"
  | "SWING"
  | "POSITION_CORE";

export type ParsedPositionStrategyState = {
  profile: PositionStrategyProfile;
  takeProfitTranchesDone: number;
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

  return {
    profile,
    takeProfitTranchesDone,
  };
}

export function buildPositionStrategyMemo(input: {
  event: string;
  note?: string;
  profile?: string | null;
  takeProfitTranchesDone?: number;
}): string {
  const profile = normalizePositionStrategyProfile(input.profile);
  const takeProfitTranchesDone = Math.max(0, Math.floor(toNumber(input.takeProfitTranchesDone, 0)));
  const parts = [
    buildStrategyMemo({
      strategyId: "core.autotrade.v1",
      event: input.event,
      note: input.note,
    }),
    `profile=${sanitizeMemoValue(profile)}`,
    `tp_tranches=${takeProfitTranchesDone}`,
  ];

  return parts.join(";");
}

export function classifyAutoTradeEntryProfile(input: {
  accountStrategy?: string | null;
  riskProfile?: string | null;
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
  const accountStrategy = normalizePositionStrategyProfile(input.accountStrategy);
  const riskProfile = String(input.riskProfile ?? "").trim().toLowerCase();

  const strongSignal = signal === "BUY" || signal === "STRONG_BUY";
  const preferredSignal = strongSignal || signal === "WATCH";
  const calmRsi = rsi14 >= 45 && rsi14 <= 60;
  const healthyRsi = rsi14 >= 42 && rsi14 <= 68;
  const highLiquidity = liquidity <= 0 || liquidity >= 15_000_000_000;
  const conservativeBias = accountStrategy === "HOLD_SAFE" || riskProfile === "safe";
  const defensiveBias = conservativeBias || accountStrategy === "REDUCE_TIGHT";
  const aggressiveBias = riskProfile === "active";

  if (score >= 82 && strongSignal && calmRsi && highLiquidity) {
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