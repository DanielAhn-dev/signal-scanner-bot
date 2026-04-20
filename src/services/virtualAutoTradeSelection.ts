export type RankedCandidate = {
  code: string;
  close: number;
  score: number;
  name: string;
  signal?: string | null;
  rsi14?: number | null;
  liquidity?: number | null;
};

export type AutoTradeCandidateSelectionMode =
  | "signal-preferred"
  | "signal-relaxed"
  | "top-score-fallback"
  | "held-add-on"
  | "none";

export type AutoTradeCandidateSelectionResult = {
  candidates: Array<{
    code: string;
    close: number;
    score: number;
    name: string;
    signal?: string | null;
    rsi14?: number | null;
    liquidity?: number | null;
  }>;
  selectionMode: AutoTradeCandidateSelectionMode;
  thresholdUsed: number;
  latestTopScore: number;
  latestAsof?: string | null;
};

export type AutoTradeRunMode = "auto" | "monday" | "daily";
export type AutoTradeRunType = "MONDAY_BUY" | "DAILY_REVIEW" | "MANUAL";

export type AutoTradeBuyConstraint = {
  buySlots: number;
  minBuyScore: number;
  blocked: boolean;
  note?: string;
  reason: "strategy-blocked-buy" | "hold-safe-probe" | "default";
};

export type HeldPositionForAddOn = {
  code: string;
  buyPrice: number;
  allowAddOn?: boolean;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Math.floor(toNumber(value, fallback));
  return n > 0 ? n : fallback;
}

function normalizeSignal(signal: unknown): string {
  return String(signal ?? "").trim().toUpperCase();
}

export function isPreferredBuySignal(signal: unknown): boolean {
  return ["BUY", "STRONG_BUY", "WATCH"].includes(normalizeSignal(signal));
}

export function deriveAdaptiveMinBuyScore(
  preferredMinBuyScore: number,
  latestTopScore: number
): number {
  const preferred = toPositiveInt(preferredMinBuyScore, 70);
  if (latestTopScore <= 0) return preferred;
  return Math.max(35, Math.min(preferred, Math.floor(latestTopScore) - 3));
}

function kstNow(base = new Date()): Date {
  return new Date(base.getTime() + 9 * 60 * 60 * 1000);
}

function isKstMonday(base = new Date()): boolean {
  return kstNow(base).getUTCDay() === 1;
}

export function selectRunType(
  mode: AutoTradeRunMode,
  now = new Date()
): AutoTradeRunType {
  if (mode === "monday") return "MONDAY_BUY";
  if (mode === "daily") return "DAILY_REVIEW";
  return isKstMonday(now) ? "MONDAY_BUY" : "DAILY_REVIEW";
}

export function applyStrategyBuyConstraint(input: {
  selectedStrategy?: string | null;
  requestedSlots: number;
  baseMinBuyScore: number;
  activeCount: number;
}): AutoTradeBuyConstraint {
  const requestedSlots = Math.max(0, Math.floor(input.requestedSlots));
  const baseMinBuyScore = toPositiveInt(input.baseMinBuyScore, 70);
  const activeCount = Math.max(0, Math.floor(input.activeCount));
  const selectedStrategy = String(input.selectedStrategy ?? "").trim().toUpperCase();

  if (selectedStrategy === "WAIT_AND_DIP_BUY") {
    return {
      buySlots: 0,
      minBuyScore: baseMinBuyScore,
      blocked: true,
      note: "선택 전략으로 신규 매수 중지",
      reason: "strategy-blocked-buy",
    };
  }

  if (selectedStrategy === "HOLD_SAFE") {
    const remainingSafeSlots = Math.max(0, 2 - activeCount);
    if (remainingSafeSlots <= 0) {
      return {
        buySlots: 0,
        minBuyScore: baseMinBuyScore,
        blocked: true,
        note: "안전 전략 유지: 총 2종목까지 보수 분산 후 기존 포지션만 관리",
        reason: "strategy-blocked-buy",
      };
    }

    const safeSlots = Math.min(requestedSlots, 1, remainingSafeSlots);
    return {
      buySlots: safeSlots,
      minBuyScore: baseMinBuyScore,
      blocked: safeSlots <= 0,
      note:
        safeSlots > 0
          ? activeCount <= 0
            ? "안전 전략 최소 진입: 상위 후보 1종목부터 보수적으로 시작"
            : "안전 전략 제한 진입: 총 2종목까지 보수 분산 허용"
          : "안전 전략 유지: 추가 매수 슬롯 없음",
      reason: safeSlots > 0 ? "hold-safe-probe" : "strategy-blocked-buy",
    };
  }

  return {
    buySlots: requestedSlots,
    minBuyScore: baseMinBuyScore,
    blocked: requestedSlots <= 0,
    reason: "default",
  };
}

export function pickAutoTradeCandidates(input: {
  rows: RankedCandidate[];
  preferredMinBuyScore: number;
  limit: number;
  heldCodes: Set<string>;
}): AutoTradeCandidateSelectionResult {
  const limit = Math.max(1, Math.floor(input.limit));
  const preferredMinBuyScore = toPositiveInt(input.preferredMinBuyScore, 70);
  const rows = input.rows
    .filter((row) => row.close > 0 && !input.heldCodes.has(row.code))
    .sort((a, b) => b.score - a.score);

  const latestTopScore = rows[0]?.score ?? 0;
  const adaptiveMinBuyScore = deriveAdaptiveMinBuyScore(
    preferredMinBuyScore,
    latestTopScore
  );

  const toCandidates = (targetRows: RankedCandidate[]) =>
    targetRows.slice(0, limit).map(({ code, close, score, name, signal, rsi14, liquidity }) => ({
      code,
      close,
      score,
      name,
      signal: signal ?? null,
      rsi14: rsi14 ?? null,
      liquidity: liquidity ?? null,
    }));

  const preferredSignalRows = rows.filter(
    (row) => row.score >= preferredMinBuyScore && isPreferredBuySignal(row.signal)
  );
  if (preferredSignalRows.length > 0) {
    return {
      candidates: toCandidates(preferredSignalRows),
      selectionMode: "signal-preferred",
      thresholdUsed: preferredMinBuyScore,
      latestTopScore,
      latestAsof: null,
    };
  }

  const relaxedSignalRows = rows.filter(
    (row) => row.score >= adaptiveMinBuyScore && isPreferredBuySignal(row.signal)
  );
  if (relaxedSignalRows.length > 0) {
    return {
      candidates: toCandidates(relaxedSignalRows),
      selectionMode: "signal-relaxed",
      thresholdUsed: adaptiveMinBuyScore,
      latestTopScore,
      latestAsof: null,
    };
  }

  const fallbackRows = rows.filter((row) => row.score >= adaptiveMinBuyScore);
  if (fallbackRows.length > 0) {
    return {
      candidates: toCandidates(fallbackRows),
      selectionMode: "top-score-fallback",
      thresholdUsed: adaptiveMinBuyScore,
      latestTopScore,
      latestAsof: null,
    };
  }

  return {
    candidates: [],
    selectionMode: "none",
    thresholdUsed: adaptiveMinBuyScore,
    latestTopScore,
    latestAsof: null,
  };
}

export function pickAutoTradeAddOnCandidates(input: {
  rows: RankedCandidate[];
  preferredMinBuyScore: number;
  limit: number;
  holdingsByCode: Map<string, HeldPositionForAddOn>;
}): AutoTradeCandidateSelectionResult {
  const limit = Math.max(1, Math.floor(input.limit));
  const preferredMinBuyScore = toPositiveInt(input.preferredMinBuyScore, 70);
  const rows = input.rows
    .filter((row) => row.close > 0 && input.holdingsByCode.has(row.code))
    .sort((a, b) => b.score - a.score);

  const latestTopScore = rows[0]?.score ?? 0;
  const adaptiveMinBuyScore = deriveAdaptiveMinBuyScore(
    preferredMinBuyScore,
    latestTopScore
  );

  const candidates = rows
    .filter((row) => {
      const holding = input.holdingsByCode.get(row.code);
      if (!holding) return false;
      if (holding.allowAddOn === false) return false;

      const pullbackPct =
        holding.buyPrice > 0 ? ((row.close - holding.buyPrice) / holding.buyPrice) * 100 : 0;
      const withinAddOnBand = pullbackPct >= -6 && pullbackPct <= 3;
      const strongContinuation =
        isPreferredBuySignal(row.signal) && row.score >= preferredMinBuyScore + 3;
      const rsi14 = toNumber(row.rsi14, 50);
      const rsiHealthy = rsi14 >= 42 && rsi14 <= 68;
      const liquidity = toNumber(row.liquidity, 0);
      const liquiditySafe = liquidity <= 0 || liquidity >= 8_000_000_000;

      return (
        row.score >= adaptiveMinBuyScore &&
        liquiditySafe &&
        rsiHealthy &&
        (withinAddOnBand || strongContinuation)
      );
    })
    .slice(0, limit)
    .map(({ code, close, score, name, signal, rsi14, liquidity }) => ({
      code,
      close,
      score,
      name,
      signal: signal ?? null,
      rsi14: rsi14 ?? null,
      liquidity: liquidity ?? null,
    }));

  return {
    candidates,
    selectionMode: candidates.length > 0 ? "held-add-on" : "none",
    thresholdUsed: adaptiveMinBuyScore,
    latestTopScore,
    latestAsof: null,
  };
}