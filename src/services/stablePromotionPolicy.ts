type StableLikeSignal = {
  stableAccumulation?: boolean;
  stableAccumulationDays?: number;
};

export type StablePromotionPolicy = {
  enabled: boolean;
  minScore: number;
};

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const s = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseMinScore(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, 0, 100);
}

export function resolveStablePromotionPolicy(): StablePromotionPolicy {
  return {
    enabled: parseBool(process.env.STABLE_PROMOTION_ENABLED, false),
    minScore: parseMinScore(process.env.STABLE_PROMOTION_MIN_SCORE, 65),
  };
}

export function hasStableAccumulationTag(signal: StableLikeSignal | null | undefined): boolean {
  if (!signal) return false;
  return Boolean(signal.stableAccumulation) || Number(signal.stableAccumulationDays ?? 0) >= 2;
}

export function isPromotedExecutionCandidate(input: {
  score: number;
  hasStableTag: boolean;
  policy: StablePromotionPolicy;
}): boolean {
  if (!input.policy.enabled) return false;
  if (!input.hasStableTag) return false;
  return Number(input.score) >= input.policy.minScore;
}

export function isExecutionCandidate(input: {
  score: number;
  hasStableTag: boolean;
  policy: StablePromotionPolicy;
}): boolean {
  if (Number(input.score) >= 70) return true;
  return isPromotedExecutionCandidate(input);
}
