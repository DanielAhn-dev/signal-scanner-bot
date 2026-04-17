import type { FundamentalSnapshot } from "../services/fundamentalService";
import type { MarketEnv, ScoreFactors } from "../score/engine";

type PlanStatus = "buy-now" | "buy-on-pullback" | "wait";
type MarketTone = "supportive" | "neutral" | "defensive";

export interface InvestmentPlanInput {
  currentPrice: number;
  factors: Partial<ScoreFactors>;
  technicalScore?: number;
  fundamental?: {
    qualityScore: FundamentalSnapshot["qualityScore"];
    per?: FundamentalSnapshot["per"];
    pbr?: FundamentalSnapshot["pbr"];
    roe?: FundamentalSnapshot["roe"];
    commentary?: FundamentalSnapshot["commentary"];
  } | null;
  marketEnv?: MarketEnv;
}

export interface InvestmentPlan {
  status: PlanStatus;
  statusLabel: string;
  marketTone: MarketTone;
  entryLow: number;
  entryHigh: number;
  stopPrice: number;
  target1: number;
  target2: number;
  stopPct: number;
  target1Pct: number;
  target2Pct: number;
  holdDays: [number, number];
  riskReward: number;
  conviction: number;
  rationale: string[];
  warnings: string[];
  summary: string;
  /** VIX/공포탐욕 기반 포지션 크기 조정 계수 (기본 1.0, VIX 높을수록 < 1.0) */
  sizeFactor: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function roundPrice(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n >= 100000) return Math.round(n / 100) * 100;
  if (n >= 10000) return Math.round(n / 10) * 10;
  return Math.round(n);
}

function safePct(base: number, ref?: number): number {
  if (!ref || !Number.isFinite(base) || !Number.isFinite(ref) || ref === 0) {
    return 0;
  }
  return ((base - ref) / ref) * 100;
}

function resolveMarketTone(marketEnv?: MarketEnv): MarketTone {
  if (!marketEnv) return "neutral";

  const defensive =
    (marketEnv.vix ?? 0) >= 25 ||
    (marketEnv.usdkrw ?? 0) >= 1380 ||
    (marketEnv.fearGreed ?? 50) >= 75;
  if (defensive) return "defensive";

  const supportive =
    (marketEnv.vix ?? 99) <= 18 &&
    (marketEnv.usdkrw ?? 9999) <= 1330 &&
    (marketEnv.fearGreed ?? 50) >= 35 &&
    (marketEnv.fearGreed ?? 50) <= 65;
  return supportive ? "supportive" : "neutral";
}

function resolveSizeFactor(marketEnv?: MarketEnv): number {
  if (!marketEnv) return 1.0;
  const vix = marketEnv.vix ?? 0;
  const fg = marketEnv.fearGreed;
  if (vix >= 30) return 0.5;
  if (vix >= 25) return 0.7;
  if (fg != null && fg <= 20) return 1.1;
  return 1.0;
}

export function buildInvestmentPlan(input: InvestmentPlanInput): InvestmentPlan {
  const currentPrice = input.currentPrice;
  const s20 = input.factors.sma20 ?? currentPrice;
  const s50 = input.factors.sma50 ?? s20;
  const s200 = input.factors.sma200 ?? s50;
  const rsi14 = input.factors.rsi14 ?? 50;
  const roc14 = input.factors.roc14 ?? 0;
  const roc21 = input.factors.roc21 ?? 0;
  const avwapSupport = input.factors.avwap_support ?? 50;
  const technicalScore = clamp(input.technicalScore ?? 50, 0, 100);
  const fundamentalQuality = clamp(input.fundamental?.qualityScore ?? 50, 0, 100);
  const marketTone = resolveMarketTone(input.marketEnv);

  const dist20 = safePct(currentPrice, s20);
  const dist50 = safePct(currentPrice, s50);
  const trendStrength = clamp(
    30 +
      (currentPrice >= s20 ? 12 : -8) +
      (currentPrice >= s50 ? 16 : -12) +
      (currentPrice >= s200 ? 10 : -10) +
      clamp(roc21 * 2.2, -10, 14) +
      clamp((rsi14 - 50) * 0.8, -12, 12),
    0,
    100
  );
  const valueSupport = clamp(
    25 +
      (fundamentalQuality - 50) * 0.7 +
      ((input.fundamental?.per ?? 18) <= 12 ? 8 : 0) +
      ((input.fundamental?.pbr ?? 1.8) <= 1.5 ? 6 : 0) +
      ((input.fundamental?.roe ?? 8) >= 12 ? 8 : 0),
    0,
    100
  );

  const conviction = clamp(
    technicalScore * 0.55 + valueSupport * 0.25 + trendStrength * 0.2,
    0,
    100
  );

  const rationale: string[] = [];
  const warnings: string[] = [];

  if (currentPrice >= s50) rationale.push("50일선 위에서 추세가 유지되고 있습니다.");
  else warnings.push("50일선 아래라 반등 확인 전 추격은 불리합니다.");

  if (avwapSupport >= 66) rationale.push("중기 매수 평균단가 위에 있어 지지력이 있습니다.");
  else warnings.push("AVWAP 지지가 약해 흔들림이 커질 수 있습니다.");

  if (fundamentalQuality >= 70) rationale.push("재무 체력이 받쳐줘 보유 버티기가 상대적으로 쉽습니다.");
  else if (fundamentalQuality < 45) warnings.push("재무 체력이 약해 짧게 대응하는 편이 안전합니다.");

  if (marketTone === "defensive") warnings.push("시장 환경이 방어적이라 목표 수익과 비중을 낮춰야 합니다.");
  else if (marketTone === "supportive") rationale.push("시장 환경이 중립 이상이라 추세 연장 확률이 높습니다.");

  let status: PlanStatus = "buy-now";
  let statusLabel = "분할 진입 가능";

  if (dist20 > 5 || rsi14 >= 72) {
    status = "buy-on-pullback";
    statusLabel = "눌림 대기";
  }
  if (currentPrice < s50 * 0.97 || conviction < 48 || (marketTone === "defensive" && rsi14 >= 68)) {
    status = "wait";
    statusLabel = "관망 우선";
  }

  let entryMid = currentPrice;
  if (status === "buy-now") {
    if (Math.abs(dist20) <= 2.5) entryMid = currentPrice;
    else if (dist20 > 0) entryMid = s20 * 1.01;
    else if (Math.abs(dist50) <= 2.5) entryMid = currentPrice;
    else entryMid = Math.max(currentPrice, s20 * 0.995);
  } else if (status === "buy-on-pullback") {
    entryMid = s20 > 0 ? s20 * 1.005 : currentPrice * 0.985;
  } else {
    entryMid = s50 > 0 ? Math.min(s20 * 0.995, s50 * 1.005) : currentPrice * 0.97;
  }

  const entryBandPct = status === "buy-now" ? 0.012 : status === "buy-on-pullback" ? 0.015 : 0.02;
  const entryLow = roundPrice(entryMid * (1 - entryBandPct));
  const entryHigh = roundPrice(entryMid * (1 + entryBandPct));
  const entryRef = (entryLow + entryHigh) / 2;

  let stopPct = 0.07;
  if (conviction >= 72 && marketTone !== "defensive") stopPct = 0.055;
  else if (conviction >= 60) stopPct = 0.062;
  else if (status === "wait") stopPct = 0.08;

  const maStop = s50 > 0 ? s50 * 0.97 : entryRef * (1 - stopPct);
  const stopPrice = roundPrice(Math.min(entryRef * (1 - stopPct), maStop));
  const realizedStopPct = Math.abs(safePct(stopPrice, entryRef));

  let target1Pct = 0.05;
  target1Pct += clamp((conviction - 55) * 0.0015, -0.015, 0.04);
  target1Pct += clamp((fundamentalQuality - 55) * 0.0008, -0.01, 0.02);
  target1Pct += clamp(roc21 * 0.0025, -0.01, 0.02);
  if (marketTone === "defensive") target1Pct -= 0.015;
  if (status === "wait") target1Pct -= 0.01;
  target1Pct = clamp(target1Pct, 0.03, 0.12);

  let target2Pct = clamp(target1Pct + Math.max(0.02, target1Pct * 0.7), 0.06, 0.18);
  if (marketTone === "defensive") target2Pct = Math.min(target2Pct, 0.12);

  const target1 = roundPrice(entryRef * (1 + target1Pct));
  const target2 = roundPrice(entryRef * (1 + target2Pct));
  const riskReward = realizedStopPct > 0 ? Number((target1Pct / (realizedStopPct / 100)).toFixed(1)) : 0;

  const holdDays: [number, number] =
    target1Pct <= 0.045
      ? [4, 10]
      : target1Pct <= 0.07
        ? [7, 18]
        : target1Pct <= 0.095
          ? [10, 25]
          : [15, 40];

  if (status === "buy-now" && dist20 >= -2 && dist20 <= 3) {
    rationale.unshift("현재 가격대가 20일선 근처라 첫 진입 위치가 과하지 않습니다.");
  }
  if (status === "buy-on-pullback") {
    warnings.unshift("지금 추격보다 20일선 부근 눌림에서 분할 진입이 낫습니다.");
  }
  if (status === "wait") {
    warnings.unshift("추세와 시장 대비 기대수익보다 리스크가 더 큽니다.");
  }

  const summary =
    status === "buy-now"
      ? "지금은 분할 진입이 가능한 구간입니다."
      : status === "buy-on-pullback"
        ? "추격보다 눌림 대기 후 접근이 더 유리합니다."
        : "당장 진입보다 추세 복원 확인이 우선입니다.";

  const sizeFactor = resolveSizeFactor(input.marketEnv);

  if (sizeFactor < 1.0) {
    warnings.push(`고변동 장 — 포지션 크기 ${Math.round(sizeFactor * 100)}%로 축소 권장`);
  } else if (sizeFactor > 1.0) {
    rationale.push("공포 극단 구간 — 역발상 비중 소폭 확대 허용");
  }

  return {
    status,
    statusLabel,
    marketTone,
    entryLow,
    entryHigh,
    stopPrice,
    target1,
    target2,
    stopPct: realizedStopPct / 100,
    target1Pct,
    target2Pct,
    holdDays,
    riskReward,
    conviction: Math.round(conviction),
    rationale: rationale.slice(0, 3),
    warnings: warnings.slice(0, 3),
    summary,
    sizeFactor,
  };
}