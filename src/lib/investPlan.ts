import type { FundamentalSnapshot } from "../services/fundamentalService";
import type { MarketEnv, ScoreFactors } from "../score/engine";

type PlanStatus = "buy-now" | "buy-on-pullback" | "wait";
type MarketTone = "supportive" | "neutral" | "defensive";

export interface InvestmentPlanInput {
  currentPrice: number;
  factors: Partial<ScoreFactors>;
  technicalScore?: number;
  variantSeed?: string;
  fundamental?: {
    qualityScore: FundamentalSnapshot["qualityScore"];
    per?: FundamentalSnapshot["per"];
    pbr?: FundamentalSnapshot["pbr"];
    roe?: FundamentalSnapshot["roe"];
    commentary?: FundamentalSnapshot["commentary"];
  } | null;
  marketEnv?: MarketEnv;
}

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickVariant(seed: string, options: string[]): string {
  if (!options.length) return "";
  return options[hashSeed(seed) % options.length];
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
  const seedBase = [
    input.variantSeed ?? "global",
    marketTone,
    Math.round(conviction),
    Math.round(rsi14),
    Math.round(dist20),
  ].join("|");

  const rationale: string[] = [];
  const warnings: string[] = [];

  if (currentPrice >= s50) {
    rationale.push(
      pickVariant(`${seedBase}|trend|up`, [
        "50일선 위에서 추세가 유지되고 있습니다.",
        "중기 추세선(50일) 위라 하방 방어력이 상대적으로 좋습니다.",
        "현재는 50일선 상단에서 흐름이 유지되는 구간입니다.",
      ])
    );
  } else {
    warnings.push(
      pickVariant(`${seedBase}|trend|down`, [
        "50일선 아래라 반등 확인 전 추격은 불리합니다.",
        "중기 추세선 아래라 성급한 진입은 변동성 리스크가 큽니다.",
        "50일선 회복 신호 전까지는 보수적으로 접근하는 편이 낫습니다.",
      ])
    );
  }

  if (avwapSupport >= 66) {
    rationale.push(
      pickVariant(`${seedBase}|avwap|support`, [
        "중기 매수 평균단가 위에 있어 지지력이 있습니다.",
        "AVWAP 기준 지지 구간 위에 있어 눌림 대응이 수월한 편입니다.",
        "체결 평균단가 상단에서 버티고 있어 추세 연장 여지가 있습니다.",
      ])
    );
  } else {
    warnings.push(
      pickVariant(`${seedBase}|avwap|weak`, [
        "AVWAP 지지가 약해 흔들림이 커질 수 있습니다.",
        "평균단가 지지력이 약해 변동성 확대에 주의가 필요합니다.",
        "AVWAP 하단 체류 구간이라 손절 기준을 더 엄격히 두는 편이 안전합니다.",
      ])
    );
  }

  if (fundamentalQuality >= 70) {
    rationale.push(
      pickVariant(`${seedBase}|fund|strong`, [
        "재무 체력이 받쳐줘 보유 버티기가 상대적으로 쉽습니다.",
        "재무 퀄리티가 양호해 조정 구간에서도 방어력이 기대됩니다.",
        "기초 체력이 좋아 추세형 보유 전략과 궁합이 나쁘지 않습니다.",
      ])
    );
  } else if (fundamentalQuality < 45) {
    warnings.push(
      pickVariant(`${seedBase}|fund|weak`, [
        "재무 체력이 약해 짧게 대응하는 편이 안전합니다.",
        "재무 점수가 낮아 손절 기준을 더 타이트하게 관리해야 합니다.",
        "기초 체력이 약한 편이라 추세 이탈 시 빠른 대응이 필요합니다.",
      ])
    );
  }

  if (marketTone === "defensive") {
    warnings.push(
      pickVariant(`${seedBase}|mkt|def`, [
        "시장 환경이 방어적이라 목표 수익과 비중을 낮춰야 합니다.",
        "방어 장세 구간이라 진입해도 포지션 크기를 줄이는 편이 안전합니다.",
        "대외 변수 민감 구간이라 수익 목표를 보수적으로 잡는 전략이 유효합니다.",
      ])
    );
  } else if (marketTone === "supportive") {
    rationale.push(
      pickVariant(`${seedBase}|mkt|sup`, [
        "시장 환경이 중립 이상이라 추세 연장 확률이 높습니다.",
        "시장 체력이 받쳐주는 국면이라 눌림 후 반등 시도가 유리합니다.",
        "매크로 환경이 과도하게 나쁘지 않아 추세 지속 가능성이 있습니다.",
      ])
    );
  }

  let status: PlanStatus = "buy-now";
  let statusLabel = "분할 진입 가능";

  if (dist20 > 5 || rsi14 >= 72) {
    status = "buy-on-pullback";
    statusLabel = "눌림 대기";
  }
  if (currentPrice < s50 * 0.965 || conviction < 45 || (marketTone === "defensive" && rsi14 >= 70)) {
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
    rationale.unshift(
      pickVariant(`${seedBase}|entry|ok`, [
        "현재 가격대가 20일선 근처라 첫 진입 위치가 과하지 않습니다.",
        "20일선 인접 구간이라 초기 진입 리스크가 상대적으로 낮습니다.",
        "단기 기준선 근처라 분할 1차 진입 포인트로 무리가 크지 않습니다.",
      ])
    );
  }
  if (status === "buy-on-pullback") {
    warnings.unshift(
      pickVariant(`${seedBase}|entry|pullback`, [
        "지금 추격보다 20일선 부근 눌림에서 분할 진입이 낫습니다.",
        "단기 과열 구간이라 눌림 확인 후 분할 접근이 유리합니다.",
        "추격보다 되돌림 진입이 손익비 측면에서 더 안정적입니다.",
      ])
    );
  }
  if (status === "wait") {
    warnings.unshift(
      pickVariant(`${seedBase}|entry|wait`, [
        "추세와 시장 대비 기대수익보다 리스크가 더 큽니다.",
        "현재는 기대수익보다 손실 가능성 관리가 우선인 구간입니다.",
        "진입 근거 대비 하방 리스크가 커 관망이 합리적인 시점입니다.",
      ])
    );
  }

  const summary =
    status === "buy-now"
      ? pickVariant(`${seedBase}|summary|now`, [
          "지금은 분할 진입이 가능한 구간입니다.",
          "현재 구간은 1차 분할 진입을 검토할 수 있습니다.",
          "과열이 심하지 않아 단계적 진입이 가능한 상태입니다.",
        ])
      : status === "buy-on-pullback"
        ? pickVariant(`${seedBase}|summary|pullback`, [
            "추격보다 눌림 대기 후 접근이 더 유리합니다.",
            "지금은 추격보다 되돌림 진입 전략이 효율적입니다.",
            "단기 눌림 확인 뒤 분할 접근이 손익비에 유리합니다.",
          ])
        : pickVariant(`${seedBase}|summary|wait`, [
            "당장 진입보다 추세 복원 확인이 우선입니다.",
            "지금은 신규 진입보다 추세 회복 신호를 확인할 시점입니다.",
            "무리한 진입보다 리스크 관리 중심의 관망이 적절합니다.",
          ]);

  const sizeFactor = resolveSizeFactor(input.marketEnv);

  if (sizeFactor < 1.0) {
    warnings.push(`고변동 장 — 포지션 크기 ${Math.round(sizeFactor * 100)}%로 축소 권장`);
  } else if (sizeFactor > 1.0) {
    rationale.push(
      pickVariant(`${seedBase}|size|expand`, [
        "공포 극단 구간 — 역발상 비중 소폭 확대 허용",
        "심리 과매도 구간으로 제한적 역발상 진입 여지가 있습니다.",
        "공포 과열 국면이라 소량 분할 확대를 검토할 수 있습니다.",
      ])
    );
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
    rationale: rationale.slice(0, 2),
    warnings: warnings.slice(0, 2),
    summary,
    sizeFactor,
  };
}