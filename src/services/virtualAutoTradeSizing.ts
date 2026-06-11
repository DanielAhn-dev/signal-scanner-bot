import type { InvestmentPrefs } from "./userService";

export type AutoTradeSizingInput = {
  availableCash: number;
  price: number;
  slotsLeft: number;
  currentHoldingCount: number;
  maxPositions: number;
  stopLossPct: number;
  riskBudgetScale?: number;
  /** 확신도 계수 (0.7~1.3). resolveConvictionScale()로 산출. 미지정 시 1. */
  conviction?: number;
  prefs?: Pick<
    InvestmentPrefs,
    "capital_krw" | "risk_profile" | "virtual_seed_capital" | "virtual_target_positions" | "split_count"
  >;
};

export type AutoTradeSizingSkipReason =
  | "below-meaningful-size"
  | "below-min-order"
  | null;

export type AutoTradeSizingResult = {
  quantity: number;
  investedAmount: number;
  budget: number;
  totalBudget: number;
  budgetPerSlot: number;
  budgetPerTargetPosition: number;
  maxBudgetByRisk: number | null;
  seedCapital: number;
  splitCount: number;
  configuredSplitCount: number;
  riskBudgetScale: number;
  conviction: number;
  targetPositions: number;
  targetWeightPct: number;
  minOrderAmount: number;
  /** 확신도 반영 전 종목당 기본 목표 예산 (시드 / 목표보유수) */
  baseTargetBudget: number;
  /** quantity가 0인 경우 사이징 단계의 사유 */
  skipReason: AutoTradeSizingSkipReason;
};

const MIN_ORDER_FLOOR_KRW = 100_000;
const MIN_ORDER_CAP_KRW = 500_000;
/** 한 종목이 시드에서 차지할 수 있는 최대 비중 */
const MAX_POSITION_WEIGHT = 0.25;
/** 기본 목표 예산 대비 이 비율 미만으로 줄어들면 매수 자체를 보류 (꼬마 포지션 방지) */
const MIN_MEANINGFUL_RATIO = 0.5;
/** 분할 미설정 시 60/40 두 번에 나눠 진입 (검증 후 추매 여력 확보) */
const DEFAULT_SPLIT_COUNT = 2;

function resolveMinOrderAmount(seedCapital: number): number {
  const dynamic = Math.floor(seedCapital * 0.03);
  return Math.min(MIN_ORDER_CAP_KRW, Math.max(MIN_ORDER_FLOOR_KRW, dynamic));
}

function toPositiveNumber(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function resolveDefaultTargetPositions(riskProfile?: InvestmentPrefs["risk_profile"]): number {
  if (riskProfile === "active") return 8;
  if (riskProfile === "balanced") return 6;
  return 5;
}

function resolveRiskBudgetPct(riskProfile?: InvestmentPrefs["risk_profile"]): number {
  if (riskProfile === "active") return 0.02;
  if (riskProfile === "balanced") return 0.015;
  return 0.01;
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(value)));
}

function resolveSplitCount(raw?: number): number {
  if (raw == null || !Number.isFinite(Number(raw))) return DEFAULT_SPLIT_COUNT;
  return clampInt(Number(raw), 1, 5);
}

function clampScale(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0.2, n));
}

function clampConviction(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.3, Math.max(0.7, n));
}

/** 1차 진입 비율: 분할 1회면 전액, 2회면 60%, 3회 이상이면 50% */
function firstTrancheRatio(splitCount: number): number {
  if (splitCount <= 1) return 1;
  if (splitCount === 2) return 0.6;
  return 0.5;
}

export type ConvictionInput = {
  score?: number | null;
  /** 진입게이트 신뢰등급 (A/B/C/D) */
  trustGrade?: string | null;
  isSectorLeader?: boolean | null;
};

/**
 * 점수·신뢰등급·섹터리더 여부로 확신도 계수(0.7~1.3)를 산출한다.
 * 확신이 높은 자리에는 목표비중보다 크게, 낮은 자리에는 작게 들어가기 위한 입력값.
 */
export function resolveConvictionScale(input: ConvictionInput): number {
  const score = Number(input.score);
  let conviction = 1;
  if (Number.isFinite(score)) {
    if (score >= 70) conviction = 1.2;
    else if (score >= 60) conviction = 1.1;
    else if (score >= 50) conviction = 1.0;
    else if (score >= 40) conviction = 0.85;
    else conviction = 0.7;
  }
  const grade = String(input.trustGrade ?? "").trim().toUpperCase();
  if (grade === "A") conviction += 0.05;
  else if (grade === "D") conviction -= 0.1;
  if (input.isSectorLeader === true) conviction += 0.1;
  return clampConviction(Number(conviction.toFixed(2)));
}

/**
 * 목표비중 기반 매수 사이징.
 *
 * 종목당 기본 목표 = 시드 / 목표보유수 (예: 2천만원·6종목이면 약 333만원 = 16.7%).
 * 여기에 확신도(0.7~1.3)를 곱해 목표 예산을 정하고, 리스크예산·일위험축소·현금은
 * 초과분을 깎는 상한으로만 작동한다. 깎인 결과가 기본 목표의 50% 미만이면
 * 의미 없는 꼬마 포지션 대신 매수를 보류한다(quantity=0, skipReason).
 */
export function calculateAutoTradeBuySizing(
  input: AutoTradeSizingInput
): AutoTradeSizingResult {
  const availableCash = Math.max(0, Math.floor(input.availableCash));
  const price = Math.max(0, Math.floor(input.price));
  const slotsLeft = Math.max(1, Math.floor(input.slotsLeft));
  const currentHoldingCount = Math.max(0, Math.floor(input.currentHoldingCount));
  const maxPositions = Math.max(1, Math.floor(input.maxPositions));
  const stopLossPct = Math.max(0, Number(input.stopLossPct) || 0);
  const riskBudgetScale = clampScale(input.riskBudgetScale);
  const conviction = clampConviction(input.conviction);

  const seedCapital =
    toPositiveNumber(input.prefs?.virtual_seed_capital) ??
    toPositiveNumber(input.prefs?.capital_krw) ??
    availableCash;

  const minOrderAmount = resolveMinOrderAmount(seedCapital);

  const configuredTargetPositions = toPositiveNumber(input.prefs?.virtual_target_positions);
  const configuredSplitCount = resolveSplitCount(input.prefs?.split_count);
  const targetPositions = clampInt(
    configuredTargetPositions ?? resolveDefaultTargetPositions(input.prefs?.risk_profile),
    1,
    maxPositions
  );

  // 참고 지표 (의사결정 로그용) — 예산 산정에는 더 이상 직접 사용하지 않음
  const remainingTargetSlots = Math.max(1, targetPositions - currentHoldingCount);
  const budgetPerSlot = Math.max(0, Math.floor(availableCash / slotsLeft));
  const budgetPerTargetPosition = Math.max(0, Math.floor(availableCash / remainingTargetSlots));

  const baseTargetBudget = Math.max(0, Math.floor(seedCapital / targetPositions));
  const maxPositionBudget = Math.max(0, Math.floor(seedCapital * MAX_POSITION_WEIGHT));
  const desiredBudget = Math.min(
    Math.floor(baseTargetBudget * conviction),
    maxPositionBudget
  );

  const riskBudgetPct = resolveRiskBudgetPct(input.prefs?.risk_profile);
  const maxBudgetByRisk =
    seedCapital > 0 && stopLossPct > 0
      ? Math.max(0, Math.floor((seedCapital * riskBudgetPct) / (stopLossPct / 100)))
      : null;

  const riskCappedBudget =
    maxBudgetByRisk != null ? Math.min(desiredBudget, maxBudgetByRisk) : desiredBudget;
  const scaledBudget = Math.max(0, Math.floor(riskCappedBudget * riskBudgetScale));
  const totalBudget = Math.min(scaledBudget, availableCash);

  const meaningfulFloor = Math.max(
    minOrderAmount,
    Math.floor(baseTargetBudget * MIN_MEANINGFUL_RATIO)
  );

  const buildResult = (
    quantity: number,
    investedAmount: number,
    budget: number,
    splitCount: number,
    skipReason: AutoTradeSizingSkipReason
  ): AutoTradeSizingResult => ({
    quantity,
    investedAmount,
    budget,
    totalBudget,
    budgetPerSlot,
    budgetPerTargetPosition,
    maxBudgetByRisk,
    seedCapital,
    splitCount,
    configuredSplitCount,
    riskBudgetScale,
    conviction,
    targetPositions,
    baseTargetBudget,
    minOrderAmount,
    skipReason,
    targetWeightPct:
      seedCapital > 0 && totalBudget > 0
        ? Number(((totalBudget / seedCapital) * 100).toFixed(2))
        : 0,
  });

  if (totalBudget < meaningfulFloor) {
    return buildResult(0, 0, 0, configuredSplitCount, "below-meaningful-size");
  }

  let splitCount = configuredSplitCount;
  let budget = Math.floor(totalBudget * firstTrancheRatio(splitCount));
  while (splitCount > 1 && budget < minOrderAmount) {
    splitCount -= 1;
    budget = Math.floor(totalBudget * firstTrancheRatio(splitCount));
  }

  let quantity = price > 0 ? Math.max(0, Math.floor(budget / price)) : 0;
  let investedAmount = quantity > 0 ? quantity * price : 0;
  let skipReason: AutoTradeSizingSkipReason = null;
  if (investedAmount > 0 && investedAmount < minOrderAmount) {
    quantity = 0;
    investedAmount = 0;
    skipReason = "below-min-order";
  }

  return buildResult(quantity, investedAmount, budget, splitCount, skipReason);
}
