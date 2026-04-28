export type RankedCandidate = {
  code: string;
  close: number;
  score: number;
  name: string;
  peg?: number | null;
  per?: number | null;
  earningsGrowthPct?: number | null;
  signal?: string | null;
  rsi14?: number | null;
  liquidity?: number | null;
  market?: string | null;
  marketCap?: number | null;
  universeLevel?: string | null;
  stableTurn?: string | null;
  stableTrust?: number | null;
  stableAboveAvg?: boolean | null;
  stableAccumulation?: boolean | null;
};

export type AutoTradeMarketPolicyMode =
  | "large-cap-defense"
  | "balanced"
  | "rotation";

export type AutoTradeMarketPolicy = {
  mode: AutoTradeMarketPolicyMode;
  label: string;
  reason: string;
  minCashReservePct: number;
  allowedMarkets: Array<"KOSPI" | "KOSDAQ">;
  kosdaqMaxRatio: number;
  requireLargeCapKospi: boolean;
  minLiquidity: number;
  minMarketCap: number;
};

type MarketOverviewLike = {
  kospi?: { changeRate?: number | null } | null;
  kosdaq?: { changeRate?: number | null } | null;
  usdkrw?: { changeRate?: number | null } | null;
  vix?: { price?: number | null } | null;
  fearGreed?: { score?: number | null } | null;
  breadth?: { advancingRatio?: number | null } | null;
};

export type AutoTradeCandidateSelectionMode =
  | "signal-preferred"
  | "signal-relaxed"
  | "top-score-fallback"
  | "held-add-on"
  | "none";

export type AutoTradeEntryProfile = "pullback-first" | "score-first";

export type AutoTradeCandidateSelectionResult = {
  candidates: Array<{
    code: string;
    close: number;
    score: number;
    name: string;
    signal?: string | null;
    rsi14?: number | null;
    liquidity?: number | null;
    market?: string | null;
    marketCap?: number | null;
    universeLevel?: string | null;
    stableTurn?: string | null;
    stableTrust?: number | null;
    stableAboveAvg?: boolean | null;
    stableAccumulation?: boolean | null;
  }>;
  selectionMode: AutoTradeCandidateSelectionMode;
  thresholdUsed: number;
  latestTopScore: number;
  latestAsof?: string | null;
  entryProfile?: AutoTradeEntryProfile;
  pullbackCandidatesUsed?: number;
  aggressiveCandidatesUsed?: number;
  filteringMetrics?: {
    initialCount: number;
    afterMarketPolicyCount: number;
    afterBaseFilterCount: number;
    candidatePoolCount: number;
    selectedCount: number;
    rejectedByReason?: Record<string, number>;
  };
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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function resolvePeg(row: RankedCandidate): number | null {
  const directPeg = toNumber(row.peg, NaN);
  if (Number.isFinite(directPeg) && directPeg > 0) {
    return directPeg;
  }

  const per = toNumber(row.per, NaN);
  const growth = toNumber(row.earningsGrowthPct, NaN);
  if (!Number.isFinite(per) || !Number.isFinite(growth) || per <= 0 || growth <= 0) {
    return null;
  }

  return per / growth;
}

function resolvePegRankBoost(row: RankedCandidate): number {
  const peg = resolvePeg(row);
  if (peg == null) return 0;
  if (peg <= 0.8) return 3.5;
  if (peg <= 1.2) return 2.5;
  if (peg <= 1.8) return 1.2;
  if (peg <= 2.5) return 0;
  if (peg <= 3.5) return -1.2;
  return -2.5;
}

function resolveCompositeRankScore(row: RankedCandidate): number {
  return row.score + resolvePegRankBoost(row);
}

function normalizeSignal(signal: unknown): string {
  return String(signal ?? "").trim().toUpperCase();
}

function normalizeStableTurn(turn: unknown): string {
  return String(turn ?? "").trim().toLowerCase();
}

function isStableBullTurn(turn: unknown): boolean {
  const normalized = normalizeStableTurn(turn);
  return normalized === "bull-weak" || normalized === "bull-strong";
}

function isStableBearTurn(turn: unknown): boolean {
  const normalized = normalizeStableTurn(turn);
  return normalized === "bear-weak" || normalized === "bear-strong";
}

export function isPreferredBuySignal(signal: unknown): boolean {
  return ["BUY", "STRONG_BUY", "WATCH"].includes(normalizeSignal(signal));
}

export function isActionableTodayBuySignal(signal: unknown): boolean {
  return ["BUY", "STRONG_BUY"].includes(normalizeSignal(signal));
}

export function deriveAdaptiveMinBuyScore(
  preferredMinBuyScore: number,
  latestTopScore: number
): number {
  const preferred = toPositiveInt(preferredMinBuyScore, 70);
  if (latestTopScore <= 0) return preferred;

  const topScore = Math.floor(latestTopScore);
  const dynamicFloor = Math.max(30, Math.floor(topScore * 0.6));
  return Math.max(dynamicFloor, Math.min(preferred, topScore - 3));
}

export function detectAutoTradeMarketPolicy(input?: {
  overview?: MarketOverviewLike | null;
}): AutoTradeMarketPolicy {
  const overview = input?.overview;
  const vix = toNumber(overview?.vix?.price, 0);
  const fearGreed = toNumber(overview?.fearGreed?.score, 50);
  const usdKrwChange = toNumber(overview?.usdkrw?.changeRate, 0);
  const kospiChange = toNumber(overview?.kospi?.changeRate, 0);
  const kosdaqChange = toNumber(overview?.kosdaq?.changeRate, 0);
  const relativeStrength = kosdaqChange - kospiChange;
  const breadthAdvancingRatio = toNumber(overview?.breadth?.advancingRatio, 50);

  if (
    (vix > 0 && vix >= 28) ||
    fearGreed <= 30 ||
    breadthAdvancingRatio <= 30 ||
    usdKrwChange >= 0.8 ||
    kospiChange <= -1.5
  ) {
    return {
      mode: "large-cap-defense",
      label: "대형주 방어",
      reason: "VIX/환율/심리/breadth 악화 또는 지수 급락",
      minCashReservePct: 35,
      allowedMarkets: ["KOSPI"],
      kosdaqMaxRatio: 0,
      requireLargeCapKospi: true,
      minLiquidity: 20_000_000_000,
      minMarketCap: 1_000_000_000_000,
    };
  }

  if (
    relativeStrength >= 1 &&
    fearGreed >= 45 &&
    (vix <= 0 || vix <= 22) &&
    usdKrwChange < 0.8
  ) {
    return {
      mode: "rotation",
      label: "순환매 확장",
      reason: "코스닥 상대강도 우위 + 변동성 안정",
      minCashReservePct: 20,
      allowedMarkets: ["KOSPI", "KOSDAQ"],
      kosdaqMaxRatio: 0.2,
      requireLargeCapKospi: false,
      minLiquidity: 8_000_000_000,
      minMarketCap: 0,
    };
  }

  return {
    mode: "balanced",
    label: "균형",
    reason: "레짐 중립 구간",
    minCashReservePct: 30,
    allowedMarkets: ["KOSPI", "KOSDAQ"],
    kosdaqMaxRatio: 0.2,
    requireLargeCapKospi: false,
    minLiquidity: 12_000_000_000,
    minMarketCap: 0,
  };
}

export function computeDynamicLargeCapFloor(
  rows: RankedCandidate[],
  targetCount = 100
): number {
  const kospiCaps = rows
    .filter((row) => row.market === "KOSPI")
    .map((row) => toNumber(row.marketCap, 0))
    .filter((value) => value > 0)
    .sort((a, b) => b - a);

  if (!kospiCaps.length) return 1_000_000_000_000;
  if (kospiCaps.length < targetCount) {
    return Math.max(1_000_000_000_000, kospiCaps[kospiCaps.length - 1] ?? 0);
  }

  return Math.max(1_000_000_000_000, kospiCaps[targetCount - 1] ?? 0);
}

export function resolveDeployableCash(input: {
  availableCash: number;
  seedCapital: number;
  minCashReservePct: number;
}): number {
  const availableCash = Math.max(0, toNumber(input.availableCash, 0));
  const seedCapital = Math.max(0, toNumber(input.seedCapital, 0));
  const reservePct = clamp(toNumber(input.minCashReservePct, 0), 0, 95);
  const reserveAmount = seedCapital > 0 ? seedCapital * (reservePct / 100) : 0;
  return Math.max(0, availableCash - reserveAmount);
}

function filterRowsByMarketPolicy(input: {
  rows: RankedCandidate[];
  policy?: AutoTradeMarketPolicy;
}): RankedCandidate[] {
  if (!input.policy) return input.rows;

  const dynamicLargeCapFloor = input.policy.requireLargeCapKospi
    ? computeDynamicLargeCapFloor(input.rows)
    : 0;

  return input.rows.filter((row) => {
    const market = String(row.market ?? "").toUpperCase();
    if (!input.policy?.allowedMarkets.includes(market as "KOSPI" | "KOSDAQ")) {
      return false;
    }

    const liquidity = toNumber(row.liquidity, 0);
    if (liquidity > 0 && liquidity < input.policy.minLiquidity) {
      return false;
    }

    if (!input.policy.requireLargeCapKospi) {
      return true;
    }

    if (market !== "KOSPI") {
      return false;
    }

    const marketCap = toNumber(row.marketCap, 0);
    const universeLevel = String(row.universeLevel ?? "").trim().toLowerCase();
    const marketCapFloor = Math.max(input.policy.minMarketCap, dynamicLargeCapFloor);

    if (marketCap >= marketCapFloor) {
      return true;
    }

    return universeLevel === "core" && marketCap >= input.policy.minMarketCap;
  });
}

function prioritizeRowsByMarketPolicy(
  rows: RankedCandidate[],
  policy?: AutoTradeMarketPolicy,
  options?: {
    entryProfile?: AutoTradeEntryProfile;
    pullbackCandidateCodes?: Set<string>;
  }
): RankedCandidate[] {
  return [...rows].sort((a, b) => {
    if (
      options?.entryProfile === "pullback-first" &&
      options.pullbackCandidateCodes &&
      options.pullbackCandidateCodes.size > 0
    ) {
      const pullbackDiff =
        Number(options.pullbackCandidateCodes.has(b.code)) -
        Number(options.pullbackCandidateCodes.has(a.code));
      if (pullbackDiff !== 0) return pullbackDiff;

      const bullTurnDiff = Number(isStableBullTurn(b.stableTurn)) - Number(isStableBullTurn(a.stableTurn));
      if (bullTurnDiff !== 0) return bullTurnDiff;

      const trustDiff = toNumber(b.stableTrust, 0) - toNumber(a.stableTrust, 0);
      if (trustDiff !== 0) return trustDiff;

      const accumulationDiff =
        Number(isAggressiveAccumulationCandidate(b)) -
        Number(isAggressiveAccumulationCandidate(a));
      if (accumulationDiff !== 0) return accumulationDiff;
    }

    const scoreDiff = resolveCompositeRankScore(b) - resolveCompositeRankScore(a);
    if (scoreDiff !== 0) return scoreDiff;

    const rawScoreDiff = b.score - a.score;
    if (rawScoreDiff !== 0) return rawScoreDiff;

    if (!policy) return 0;

    const marketRank = (row: RankedCandidate) => {
      if (policy.mode === "large-cap-defense") {
        return row.market === "KOSPI" ? 0 : 1;
      }
      if (policy.mode === "balanced") {
        return row.market === "KOSPI" ? 0 : 1;
      }
      return row.market === "KOSDAQ" ? 0 : 1;
    };

    return marketRank(a) - marketRank(b);
  });
}

function takeRowsWithinMarketPolicy(input: {
  rows: RankedCandidate[];
  limit: number;
  policy?: AutoTradeMarketPolicy;
  entryProfile?: AutoTradeEntryProfile;
  pullbackCandidateCodes?: Set<string>;
}): RankedCandidate[] {
  const prioritized = prioritizeRowsByMarketPolicy(input.rows, input.policy, {
    entryProfile: input.entryProfile,
    pullbackCandidateCodes: input.pullbackCandidateCodes,
  });
  if (!input.policy) return prioritized.slice(0, input.limit);

  const result: RankedCandidate[] = [];
  let kosdaqCount = 0;
  const ratio = clamp(input.policy.kosdaqMaxRatio, 0, 1);
  const kosdaqMaxSlots = (() => {
    if (ratio <= 0) return 0;
    const raw = Math.floor(input.limit * ratio);
    if (raw > 0) return raw;
    return input.policy.mode === "rotation" && input.limit >= 4 ? 1 : 0;
  })();

  for (const row of prioritized) {
    if (result.length >= input.limit) break;
    if (row.market === "KOSDAQ") {
      if (kosdaqCount >= kosdaqMaxSlots) continue;
      kosdaqCount += 1;
    }
    result.push(row);
  }

  return result;
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
  // auto: 신호 기반으로 매일 진입/매도 검토 (달력 제약 없음)
  return "DAILY_REVIEW";
}

export function applyStrategyBuyConstraint(input: {
  selectedStrategy?: string | null;
  requestedSlots: number;
  baseMinBuyScore: number;
  activeCount: number;
  pacingRelaxLevel?: 0 | 1 | 2;
}): AutoTradeBuyConstraint {
  const requestedSlots = Math.max(0, Math.floor(input.requestedSlots));
  const relaxLevel = input.pacingRelaxLevel ?? 0;
  const relaxedOffset = relaxLevel >= 2 ? 4 : relaxLevel >= 1 ? 2 : 0;
  const baseMinBuyScore = Math.max(30, toPositiveInt(input.baseMinBuyScore, 70) - relaxedOffset);
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

export function deriveEntryProfile(input: {
  selectedStrategy?: string | null;
  riskProfile?: string | null;
}): AutoTradeEntryProfile {
  const selectedStrategy = String(input.selectedStrategy ?? "").trim().toUpperCase();
  const riskProfile = String(input.riskProfile ?? "").trim().toLowerCase();

  if (selectedStrategy === "POSITION_CORE" && riskProfile === "active") {
    return "pullback-first";
  }

  return "score-first";
}

type AggressiveAccumulationLike = {
  score: number;
  signal?: string | null;
  rsi14?: number | null;
  liquidity?: number | null;
  stableTurn?: string | null;
  stableTrust?: number | null;
  stableAboveAvg?: boolean | null;
};

function isAggressiveAccumulationLike(row: AggressiveAccumulationLike): boolean {
  const signalPreferred = isPreferredBuySignal(row.signal);
  const rsi14 = toNumber(row.rsi14, 50);
  const liquidity = toNumber(row.liquidity, 0);
  const liquiditySafe = liquidity <= 0 || liquidity >= 12_000_000_000;
  const hasStableContext =
    row.stableTurn != null || row.stableTrust != null || row.stableAboveAvg != null;
  const stableTrust = toNumber(row.stableTrust, 50);
  const stableAboveAvg = Boolean(row.stableAboveAvg ?? false);
  const stableTurnPreferred = !hasStableContext || isStableBullTurn(row.stableTurn);
  const stableTrustPreferred = !hasStableContext || stableTrust >= 64;
  const stableAvgPreferred = !hasStableContext || stableAboveAvg;

  return (
    (signalPreferred || stableTurnPreferred) &&
    row.score >= 76 &&
    rsi14 >= 48 &&
    rsi14 <= 70 &&
    liquiditySafe &&
    stableTrustPreferred &&
    stableAvgPreferred
  );
}

function isAggressiveAccumulationCandidate(row: RankedCandidate): boolean {
  return isAggressiveAccumulationLike(row);
}

function countPullbackCandidates(input: {
  candidates: Array<{ code: string }>;
  pullbackCandidateCodes?: Set<string>;
}): number {
  if (!input.pullbackCandidateCodes || input.pullbackCandidateCodes.size <= 0) {
    return 0;
  }
  return input.candidates.reduce((sum, candidate) => {
    return sum + (input.pullbackCandidateCodes?.has(candidate.code) ? 1 : 0);
  }, 0);
}

function resolveEffectiveScoreFloor(input: {
  row: RankedCandidate;
  floor: number;
  entryProfile: AutoTradeEntryProfile;
  pullbackCandidateCodes?: Set<string>;
}): number {
  if (
    input.entryProfile === "pullback-first" &&
    input.pullbackCandidateCodes?.has(input.row.code)
  ) {
    return Math.max(30, input.floor - 2);
  }
  if (input.entryProfile === "pullback-first" && isAggressiveAccumulationCandidate(input.row)) {
    return Math.max(30, input.floor - 1);
  }
  if (input.entryProfile === "pullback-first" && normalizeStableTurn(input.row.stableTurn) === "bull-strong") {
    return Math.max(30, input.floor - 2);
  }
  return input.floor;
}

function countAggressiveCandidates(input: {
  candidates: Array<{
    code: string;
    score: number;
    signal?: string | null;
    rsi14?: number | null;
    liquidity?: number | null;
    stableTurn?: string | null;
    stableTrust?: number | null;
    stableAboveAvg?: boolean | null;
  }>;
}): number {
  return input.candidates.reduce((sum, candidate) => {
    return sum + (isAggressiveAccumulationLike(candidate) ? 1 : 0);
  }, 0);
}

export function pickAutoTradeCandidates(input: {
  rows: RankedCandidate[];
  preferredMinBuyScore: number;
  limit: number;
  heldCodes: Set<string>;
  marketPolicy?: AutoTradeMarketPolicy;
  entryProfile?: AutoTradeEntryProfile;
  pullbackCandidateCodes?: Set<string>;
}): AutoTradeCandidateSelectionResult {
  const limit = Math.max(1, Math.floor(input.limit));
  const preferredMinBuyScore = toPositiveInt(input.preferredMinBuyScore, 70);
  const entryProfile: AutoTradeEntryProfile = input.entryProfile ?? "score-first";
  const initialCount = input.rows.length;
  const marketPolicyRows = filterRowsByMarketPolicy({
    rows: input.rows,
    policy: input.marketPolicy,
  });
  const baseFilteredRows = marketPolicyRows
    .filter((row) => row.close > 0 && !input.heldCodes.has(row.code))
    .sort((a, b) => resolveCompositeRankScore(b) - resolveCompositeRankScore(a));
  const rows = baseFilteredRows;

  const filteringMetricsBase = {
    initialCount,
    afterMarketPolicyCount: marketPolicyRows.length,
    afterBaseFilterCount: rows.length,
    candidatePoolCount: rows.length,
    rejectedByReason: {
      marketPolicy: Math.max(0, initialCount - marketPolicyRows.length),
      invalidOrHeld: Math.max(0, marketPolicyRows.length - rows.length),
    },
  };

  const latestTopScore = rows[0]?.score ?? 0;
  const adaptiveMinBuyScore = deriveAdaptiveMinBuyScore(
    preferredMinBuyScore,
    latestTopScore
  );

  const toCandidates = (targetRows: RankedCandidate[]) =>
    takeRowsWithinMarketPolicy({
      rows: targetRows,
      limit,
      policy: input.marketPolicy,
      entryProfile,
      pullbackCandidateCodes: input.pullbackCandidateCodes,
    }).map(({ code, close, score, name, signal, rsi14, liquidity, market, marketCap, universeLevel, stableTurn, stableTrust, stableAboveAvg, stableAccumulation }) => ({
      code,
      close,
      score,
      name,
      signal: signal ?? null,
      rsi14: rsi14 ?? null,
      liquidity: liquidity ?? null,
      market: market ?? null,
      marketCap: marketCap ?? null,
      universeLevel: universeLevel ?? null,
      stableTurn: stableTurn ?? null,
      stableTrust: stableTrust ?? null,
      stableAboveAvg: stableAboveAvg ?? null,
      stableAccumulation: stableAccumulation ?? null,
    }));

  const preferredSignalRows = rows.filter((row) => {
    const scoreFloor = resolveEffectiveScoreFloor({
      row,
      floor: preferredMinBuyScore,
      entryProfile,
      pullbackCandidateCodes: input.pullbackCandidateCodes,
    });
    const stableBullPreferred =
      isStableBullTurn(row.stableTurn) &&
      toNumber(row.stableTrust, 0) >= 68 &&
      Boolean(row.stableAboveAvg ?? false);
    return row.score >= scoreFloor && (isActionableTodayBuySignal(row.signal) || stableBullPreferred);
  });
  if (preferredSignalRows.length > 0) {
    const candidates = toCandidates(preferredSignalRows);
    return {
      candidates,
      selectionMode: "signal-preferred",
      thresholdUsed: preferredMinBuyScore,
      latestTopScore,
      latestAsof: null,
      entryProfile,
      pullbackCandidatesUsed: countPullbackCandidates({
        candidates,
        pullbackCandidateCodes: input.pullbackCandidateCodes,
      }),
      aggressiveCandidatesUsed: countAggressiveCandidates({ candidates }),
      filteringMetrics: {
        ...filteringMetricsBase,
        selectedCount: candidates.length,
        rejectedByReason: {
          ...filteringMetricsBase.rejectedByReason,
          scoreOrSignal: Math.max(0, rows.length - preferredSignalRows.length),
          limit: Math.max(0, preferredSignalRows.length - candidates.length),
        },
      },
    };
  }

  const relaxedSignalRows = rows.filter((row) => {
    const scoreFloor = resolveEffectiveScoreFloor({
      row,
      floor: adaptiveMinBuyScore,
      entryProfile,
      pullbackCandidateCodes: input.pullbackCandidateCodes,
    });
    const stableBullPreferred =
      isStableBullTurn(row.stableTurn) &&
      toNumber(row.stableTrust, 0) >= 64 &&
      Boolean(row.stableAboveAvg ?? false);
    return row.score >= scoreFloor && (isPreferredBuySignal(row.signal) || stableBullPreferred);
  });
  if (relaxedSignalRows.length > 0) {
    const candidates = toCandidates(relaxedSignalRows);
    return {
      candidates,
      selectionMode: "signal-relaxed",
      thresholdUsed: adaptiveMinBuyScore,
      latestTopScore,
      latestAsof: null,
      entryProfile,
      pullbackCandidatesUsed: countPullbackCandidates({
        candidates,
        pullbackCandidateCodes: input.pullbackCandidateCodes,
      }),
      aggressiveCandidatesUsed: countAggressiveCandidates({ candidates }),
      filteringMetrics: {
        ...filteringMetricsBase,
        selectedCount: candidates.length,
        rejectedByReason: {
          ...filteringMetricsBase.rejectedByReason,
          scoreOrSignal: Math.max(0, rows.length - relaxedSignalRows.length),
          limit: Math.max(0, relaxedSignalRows.length - candidates.length),
        },
      },
    };
  }

  const expandedSignalRows = rows.filter((row) => {
    const scoreFloor = resolveEffectiveScoreFloor({
      row,
      floor: adaptiveMinBuyScore,
      entryProfile,
      pullbackCandidateCodes: input.pullbackCandidateCodes,
    });
    if (row.score < scoreFloor) return false;
    const normalized = normalizeSignal(row.signal);
    const stableAccumulation = Boolean(row.stableAccumulation ?? false);
    const avoidBearStrong = normalizeStableTurn(row.stableTurn) !== "bear-strong";
    return (normalized === "HOLD" || normalized === "ACCUMULATE" || stableAccumulation) && avoidBearStrong;
  });
  if (expandedSignalRows.length > 0) {
    const candidates = toCandidates(expandedSignalRows);
    return {
      candidates,
      selectionMode: "signal-relaxed",
      thresholdUsed: adaptiveMinBuyScore,
      latestTopScore,
      latestAsof: null,
      entryProfile,
      pullbackCandidatesUsed: countPullbackCandidates({
        candidates,
        pullbackCandidateCodes: input.pullbackCandidateCodes,
      }),
      aggressiveCandidatesUsed: countAggressiveCandidates({ candidates }),
      filteringMetrics: {
        ...filteringMetricsBase,
        selectedCount: candidates.length,
        rejectedByReason: {
          ...filteringMetricsBase.rejectedByReason,
          scoreOrSignal: Math.max(0, rows.length - expandedSignalRows.length),
          limit: Math.max(0, expandedSignalRows.length - candidates.length),
        },
      },
    };
  }

  const fallbackRows = rows.filter((row) => {
    const scoreFloor = resolveEffectiveScoreFloor({
      row,
      floor: adaptiveMinBuyScore,
      entryProfile,
      pullbackCandidateCodes: input.pullbackCandidateCodes,
    });
    return row.score >= scoreFloor;
  });
  if (fallbackRows.length > 0) {
    const candidates = toCandidates(fallbackRows);
    return {
      candidates,
      selectionMode: "top-score-fallback",
      thresholdUsed: adaptiveMinBuyScore,
      latestTopScore,
      latestAsof: null,
      entryProfile,
      pullbackCandidatesUsed: countPullbackCandidates({
        candidates,
        pullbackCandidateCodes: input.pullbackCandidateCodes,
      }),
      aggressiveCandidatesUsed: countAggressiveCandidates({ candidates }),
      filteringMetrics: {
        ...filteringMetricsBase,
        selectedCount: candidates.length,
        rejectedByReason: {
          ...filteringMetricsBase.rejectedByReason,
          scoreThreshold: Math.max(0, rows.length - fallbackRows.length),
          limit: Math.max(0, fallbackRows.length - candidates.length),
        },
      },
    };
  }

  return {
    candidates: [],
    selectionMode: "none",
    thresholdUsed: adaptiveMinBuyScore,
    latestTopScore,
    latestAsof: null,
    entryProfile,
    pullbackCandidatesUsed: 0,
    aggressiveCandidatesUsed: 0,
    filteringMetrics: {
      ...filteringMetricsBase,
      selectedCount: 0,
      rejectedByReason: {
        ...filteringMetricsBase.rejectedByReason,
        scoreOrSignal: rows.length,
      },
    },
  };
}

export function pickAutoTradeAddOnCandidates(input: {
  rows: RankedCandidate[];
  preferredMinBuyScore: number;
  limit: number;
  holdingsByCode: Map<string, HeldPositionForAddOn>;
  marketPolicy?: AutoTradeMarketPolicy;
}): AutoTradeCandidateSelectionResult {
  const limit = Math.max(1, Math.floor(input.limit));
  const preferredMinBuyScore = toPositiveInt(input.preferredMinBuyScore, 70);
  const initialCount = input.rows.length;
  const marketPolicyRows = filterRowsByMarketPolicy({
    rows: input.rows,
    policy: input.marketPolicy,
  });
  const rows = marketPolicyRows
    .filter((row) => row.close > 0 && input.holdingsByCode.has(row.code))
    .sort((a, b) => resolveCompositeRankScore(b) - resolveCompositeRankScore(a));

  const latestTopScore = rows[0]?.score ?? 0;
  const adaptiveMinBuyScore = deriveAdaptiveMinBuyScore(
    preferredMinBuyScore,
    latestTopScore
  );

  const candidatePool = takeRowsWithinMarketPolicy({
    rows,
    limit,
    policy: input.marketPolicy,
  });

  const rejectedByReason: Record<string, number> = {
    marketPolicy: Math.max(0, initialCount - marketPolicyRows.length),
    invalidOrNotHeld: Math.max(0, marketPolicyRows.length - rows.length),
    addOnDisabled: 0,
    scoreThreshold: 0,
    liquidity: 0,
    rsi: 0,
    addOnBand: 0,
  };

  const candidates = candidatePool
    .filter((row) => {
      const holding = input.holdingsByCode.get(row.code);
      if (!holding) {
        rejectedByReason.invalidOrNotHeld += 1;
        return false;
      }
      if (holding.allowAddOn === false) {
        rejectedByReason.addOnDisabled += 1;
        return false;
      }

      const pullbackPct =
        holding.buyPrice > 0 ? ((row.close - holding.buyPrice) / holding.buyPrice) * 100 : 0;
      const withinAddOnBand = pullbackPct >= -6 && pullbackPct <= 3;
      const strongContinuation =
        (isPreferredBuySignal(row.signal) || isStableBullTurn(row.stableTurn)) &&
        row.score >= preferredMinBuyScore + 3;
      const rsi14 = toNumber(row.rsi14, 50);
      const rsiHealthy = rsi14 >= 42 && rsi14 <= 68;
      const liquidity = toNumber(row.liquidity, 0);
      const liquiditySafe = liquidity <= 0 || liquidity >= 8_000_000_000;
      const hasStableContext =
        row.stableTurn != null || row.stableTrust != null || row.stableAboveAvg != null;
      const stableTrust = toNumber(row.stableTrust, 50);
      const avoidBearTurn = !isStableBearTurn(row.stableTurn);

      if (row.score < adaptiveMinBuyScore) {
        rejectedByReason.scoreThreshold += 1;
        return false;
      }
      if (!liquiditySafe) {
        rejectedByReason.liquidity += 1;
        return false;
      }
      if (!rsiHealthy) {
        rejectedByReason.rsi += 1;
        return false;
      }
      if (hasStableContext && (!avoidBearTurn || stableTrust < 55)) {
        rejectedByReason.addOnBand += 1;
        return false;
      }
      if (!(withinAddOnBand || strongContinuation)) {
        rejectedByReason.addOnBand += 1;
        return false;
      }

      return true;
    })
    .map(({ code, close, score, name, signal, rsi14, liquidity, stableTurn, stableTrust, stableAboveAvg, stableAccumulation }) => ({
      code,
      close,
      score,
      name,
      signal: signal ?? null,
      rsi14: rsi14 ?? null,
      liquidity: liquidity ?? null,
      stableTurn: stableTurn ?? null,
      stableTrust: stableTrust ?? null,
      stableAboveAvg: stableAboveAvg ?? null,
      stableAccumulation: stableAccumulation ?? null,
    }));

  return {
    candidates,
    selectionMode: candidates.length > 0 ? "held-add-on" : "none",
    thresholdUsed: adaptiveMinBuyScore,
    latestTopScore,
    latestAsof: null,
    entryProfile: "score-first",
    pullbackCandidatesUsed: 0,
    aggressiveCandidatesUsed: 0,
    filteringMetrics: {
      initialCount,
      afterMarketPolicyCount: marketPolicyRows.length,
      afterBaseFilterCount: rows.length,
      candidatePoolCount: candidatePool.length,
      selectedCount: candidates.length,
      rejectedByReason,
    },
  };
}