export type SignalGateFactors = {
  sma50?: number;
  sma200?: number;
  rsi14?: number;
  avwap_support?: number;
  vol_ratio?: number;
  macd_cross?: string | null;
  stable_turn?: string | null;
  stable_turn_trust?: number;
  stable_above_avg?: boolean;
};

export type SignalGateResult = {
  passed: boolean;
  trustScore: number;
  grade: "A" | "B" | "C" | "D";
  reasons: string[];
  metrics: {
    aboveSma200: boolean;
    aboveSma50: boolean;
    rsi14: number;
    avwapSupport: number;
    volRatio: number;
    macdCross: string;
    stableTurn: string;
    stableTrust: number;
    stableAboveAvg: boolean;
  };
};

export type TrendBreakExitSignal = {
  exitAction: "HOLD" | "STOP_LOSS" | "TAKE_PROFIT";
  reason:
    | "none"
    | "trend-break-sma200"
    | "trend-break-sma50"
    | "signal-strong-sell"
    | "signal-sell";
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeMacdCross(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "golden" || normalized === "dead") return normalized;
  return "none";
}

function normalizeStableTurn(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "bull-weak" ||
    normalized === "bull-strong" ||
    normalized === "bear-weak" ||
    normalized === "bear-strong"
  ) {
    return normalized;
  }
  return "none";
}

function toGrade(score: number): SignalGateResult["grade"] {
  if (score >= 80) return "A";
  if (score >= 68) return "B";
  if (score >= 56) return "C";
  return "D";
}

export function evaluateAutoTradeSignalGate(input: {
  currentPrice: number;
  score: number;
  factors?: Record<string, unknown> | null;
  minTrustScore?: number;
  requireAboveSma200?: boolean;
}): SignalGateResult {
  const currentPrice = Math.max(0, toNumber(input.currentPrice, 0));
  const score = toNumber(input.score, 0);
  const factors = (input.factors ?? {}) as SignalGateFactors;
  const sma200 = Math.max(0, toNumber(factors.sma200, 0));
  const sma50 = Math.max(0, toNumber(factors.sma50, 0));
  const rsi14 = toNumber(factors.rsi14, 50);
  const avwapSupport = clamp(toNumber(factors.avwap_support, 50), 0, 100);
  const volRatio = Math.max(0, toNumber(factors.vol_ratio, 1));
  const macdCross = normalizeMacdCross(factors.macd_cross);
  const stableTurn = normalizeStableTurn(factors.stable_turn);
  const stableTrust = clamp(toNumber(factors.stable_turn_trust, 60), 0, 100);
  const stableAboveAvg =
    factors.stable_above_avg == null ? true : Boolean(factors.stable_above_avg);
  const aboveSma200 = sma200 > 0 ? currentPrice >= sma200 : true;
  const aboveSma50 = sma50 > 0 ? currentPrice >= sma50 : true;

  let trustScore = 50;

  trustScore += aboveSma200 ? 18 : -30;
  trustScore += aboveSma50 ? 10 : -10;

  if (avwapSupport >= 66) trustScore += 10;
  else if (avwapSupport >= 50) trustScore += 5;
  else trustScore -= 8;

  if (volRatio >= 1.8) trustScore += 10;
  else if (volRatio >= 1.2) trustScore += 6;
  else if (volRatio < 0.9) trustScore -= 8;

  if (rsi14 >= 48 && rsi14 <= 68) trustScore += 8;
  else if (rsi14 > 68 && rsi14 <= 74) trustScore += 2;
  else if (rsi14 > 74) trustScore -= 8;
  else if (rsi14 < 35) trustScore -= 10;

  if (macdCross === "golden") trustScore += 8;
  if (macdCross === "dead") trustScore -= 14;

  if (stableAboveAvg) trustScore += 8;
  else trustScore -= 10;

  if (stableTurn === "bull-strong") trustScore += 10;
  else if (stableTurn === "bull-weak") trustScore += 5;
  else if (stableTurn === "bear-strong") trustScore -= 12;
  else if (stableTurn === "bear-weak") trustScore -= 6;

  if (stableTrust >= 75) trustScore += 6;
  else if (stableTrust >= 65) trustScore += 3;
  else if (stableTrust <= 45) trustScore -= 8;

  if (score >= 78) trustScore += 8;
  else if (score >= 70) trustScore += 5;
  else if (score >= 60) trustScore += 2;
  else trustScore -= 4;

  trustScore = clamp(Math.round(trustScore), 0, 100);

  const minTrustScore = clamp(toNumber(input.minTrustScore, 62), 0, 100);
  const requireAboveSma200 = input.requireAboveSma200 !== false;

  const reasons: string[] = [];
  if (requireAboveSma200 && !aboveSma200) reasons.push("가격이 장기 세력선(sma200) 아래");
  if (!aboveSma50) reasons.push("가격이 추세선(sma50) 아래");
  if (macdCross === "dead") reasons.push("MACD 데드크로스");
  if (stableTurn === "bear-strong") reasons.push("Stable 턴 약세 강화 구간");
  if (!stableAboveAvg) reasons.push("가격이 세력 평단 아래");
  if (volRatio < 0.9) reasons.push("거래량 신뢰도 부족");
  if (rsi14 > 74) reasons.push("RSI 과열");
  if (trustScore < minTrustScore) reasons.push(`신뢰도 ${trustScore}점 < 기준 ${minTrustScore}점`);

  const passed =
    trustScore >= minTrustScore &&
    (!requireAboveSma200 || aboveSma200) &&
    macdCross !== "dead" &&
    stableTurn !== "bear-strong";

  return {
    passed,
    trustScore,
    grade: toGrade(trustScore),
    reasons,
    metrics: {
      aboveSma200,
      aboveSma50,
      rsi14,
      avwapSupport,
      volRatio,
      macdCross,
      stableTurn,
      stableTrust,
      stableAboveAvg,
    },
  };
}

export function detectTrendBreakExitSignal(input: {
  currentPrice: number;
  pnlPct: number;
  factors?: Record<string, unknown> | null;
  signal?: string | null;
}): TrendBreakExitSignal {
  const currentPrice = Math.max(0, toNumber(input.currentPrice, 0));
  const pnlPct = toNumber(input.pnlPct, 0);
  const factors = (input.factors ?? {}) as SignalGateFactors;
  const sma200 = Math.max(0, toNumber(factors.sma200, 0));
  const sma50 = Math.max(0, toNumber(factors.sma50, 0));
  const normalizedSignal = String(input.signal ?? "").trim().toUpperCase();

  // SMA200 이탈 → 즉시 손절 (최우선)
  if (sma200 > 0 && currentPrice < sma200) {
    return {
      exitAction: "STOP_LOSS",
      reason: "trend-break-sma200",
    };
  }

  // STRONG_SELL 신호 → 수익이면 익절, 손실이면 손절로 즉시 청산
  if (normalizedSignal === "STRONG_SELL") {
    return {
      exitAction: pnlPct > 0 ? "TAKE_PROFIT" : "STOP_LOSS",
      reason: "signal-strong-sell",
    };
  }

  // SELL 신호 + 수익 중 → 익절 선취
  if (normalizedSignal === "SELL" && pnlPct > 0) {
    return {
      exitAction: "TAKE_PROFIT",
      reason: "signal-sell",
    };
  }

  // SMA50 이탈 + 소폭 수익 → 익절
  if (sma50 > 0 && currentPrice < sma50 && pnlPct > 1.0) {
    return {
      exitAction: "TAKE_PROFIT",
      reason: "trend-break-sma50",
    };
  }

  return {
    exitAction: "HOLD",
    reason: "none",
  };
}
