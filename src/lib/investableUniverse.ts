type CandidateLike = {
  code?: string | null;
  name?: string | null;
  market?: string | null;
  universe_level?: string | null;
  liquidity?: number | null;
  is_sector_leader?: boolean | null;
  total_score?: number | null;
  momentum_score?: number | null;
  value_score?: number | null;
  rsi14?: number | null;
  market_cap?: number | null;
};

export type RiskProfile = "safe" | "balanced" | "active";

const EXCLUDED_NAME_PATTERNS = [
  /스팩/i,
  /리츠/i,
  /레버리지/i,
  /인버스/i,
  /선물/i,
  /채권/i,
  /ETN/i,
  /ETF/i,
  /우B?$/i,
  /우선주/i,
  /풋/i,
  /콜/i,
  /BLANK/i,
];

export function isExcludedStockName(name?: string | null): boolean {
  const normalized = (name || "").trim();
  if (!normalized) return true;
  return EXCLUDED_NAME_PATTERNS.some((pattern) => pattern.test(normalized));
}

const PROFILE_BONUS: Record<RiskProfile, { kospi: number; kosdaq: number; liquidityPenalty: number; passScore: number }> = {
  safe: { kospi: 45, kosdaq: -10, liquidityPenalty: -12, passScore: 35 },
  balanced: { kospi: 32, kosdaq: -2, liquidityPenalty: -8, passScore: 24 },
  active: { kospi: 20, kosdaq: 6, liquidityPenalty: -3, passScore: 15 },
};

export function getSafetyPreferenceScore(stock: CandidateLike, profile: RiskProfile = "safe"): number {
  let score = 0;
  const policy = PROFILE_BONUS[profile];

  if (isExcludedStockName(stock.name)) return -9999;

  if (stock.market === "KOSPI") score += policy.kospi;
  else if (stock.market === "KOSDAQ") score += policy.kosdaq;
  else score -= 20;

  if (stock.universe_level === "core") score += 28;
  else if (stock.universe_level === "extended") score += 14;
  else if (stock.universe_level) score -= 18;

  if (stock.is_sector_leader) score += 14;

  const liquidity = Number(stock.liquidity ?? 0);
  if (liquidity >= 300_000_000_000) score += 18;
  else if (liquidity >= 100_000_000_000) score += 12;
  else if (liquidity >= 30_000_000_000) score += 6;
  else if (liquidity > 0 && liquidity < 10_000_000_000) score += policy.liquidityPenalty;

  const marketCap = Number(stock.market_cap ?? 0);
  if (marketCap >= 5_000_000_000_000) score += 16;
  else if (marketCap >= 1_000_000_000_000) score += 8;

  const totalScore = Number(stock.total_score ?? 0);
  const momentumScore = Number(stock.momentum_score ?? 0);
  const valueScore = Number(stock.value_score ?? 0);
  if (Number.isFinite(totalScore)) score += Math.max(0, Math.min(18, totalScore * 0.18));
  if (Number.isFinite(momentumScore)) score += Math.max(0, Math.min(10, momentumScore * 0.12));
  if (Number.isFinite(valueScore)) score += Math.max(0, Math.min(8, valueScore * 0.1));

  const rsi = Number(stock.rsi14 ?? 50);
  if (Number.isFinite(rsi)) {
    if (rsi >= 40 && rsi <= 68) score += 6;
    else if (rsi >= 72) score -= 6;
  }

  return score;
}

export function isSaferInvestmentCandidate(stock: CandidateLike, profile: RiskProfile = "safe"): boolean {
  if (isExcludedStockName(stock.name)) return false;
  if (stock.market && stock.market !== "KOSPI") {
    const exceptionalKosdaq =
      stock.market === "KOSDAQ" &&
      stock.universe_level === "core" &&
      Number(stock.liquidity ?? 0) >= (profile === "active" ? 100_000_000_000 : 300_000_000_000);
    if (!exceptionalKosdaq) return false;
  }

  if (stock.universe_level && !["core", "extended"].includes(stock.universe_level)) {
    return false;
  }

  return getSafetyPreferenceScore(stock, profile) >= PROFILE_BONUS[profile].passScore;
}

export function pickSaferCandidates<T extends CandidateLike>(
  stocks: T[],
  limit: number,
  profile: RiskProfile = "safe"
): T[] {
  const ranked = stocks
    .map((stock) => ({ stock, score: getSafetyPreferenceScore(stock, profile) }))
    .filter((item) => item.score > -9999)
    .sort((a, b) => b.score - a.score);

  const strict = ranked.filter((item) => isSaferInvestmentCandidate(item.stock, profile));
  const source = strict.length >= limit ? strict : ranked;
  return source.slice(0, limit).map((item) => item.stock);
}