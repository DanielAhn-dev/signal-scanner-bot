export type RankedCandidate = {
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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
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

  if (
    (vix > 0 && vix >= 28) ||
    fearGreed <= 30 ||
    usdKrwChange >= 0.8 ||
    kospiChange <= -1.5
  ) {
    return {
      mode: "large-cap-defense",
      label: "대형주 방어",
      reason: "VIX/환율/심리 악화 또는 지수 급락",
      minCashReservePct: 40,
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
  policy?: AutoTradeMarketPolicy
): RankedCandidate[] {
  if (!policy) return rows;

  return [...rows].sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;

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
}): RankedCandidate[] {
  const prioritized = prioritizeRowsByMarketPolicy(input.rows, input.policy);
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
  marketPolicy?: AutoTradeMarketPolicy;
}): AutoTradeCandidateSelectionResult {
  const limit = Math.max(1, Math.floor(input.limit));
  const preferredMinBuyScore = toPositiveInt(input.preferredMinBuyScore, 70);
  const rows = filterRowsByMarketPolicy({
    rows: input.rows,
    policy: input.marketPolicy,
  })
    .filter((row) => row.close > 0 && !input.heldCodes.has(row.code))
    .sort((a, b) => b.score - a.score);

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
    }).map(({ code, close, score, name, signal, rsi14, liquidity, market, marketCap, universeLevel }) => ({
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
  marketPolicy?: AutoTradeMarketPolicy;
}): AutoTradeCandidateSelectionResult {
  const limit = Math.max(1, Math.floor(input.limit));
  const preferredMinBuyScore = toPositiveInt(input.preferredMinBuyScore, 70);
  const rows = filterRowsByMarketPolicy({
    rows: input.rows,
    policy: input.marketPolicy,
  })
    .filter((row) => row.close > 0 && input.holdingsByCode.has(row.code))
    .sort((a, b) => b.score - a.score);

  const latestTopScore = rows[0]?.score ?? 0;
  const adaptiveMinBuyScore = deriveAdaptiveMinBuyScore(
    preferredMinBuyScore,
    latestTopScore
  );

  const candidates = takeRowsWithinMarketPolicy({
    rows,
    limit,
    policy: input.marketPolicy,
  })
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