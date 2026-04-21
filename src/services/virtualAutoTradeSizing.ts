import type { InvestmentPrefs } from "./userService";

export type AutoTradeSizingInput = {
  availableCash: number;
  price: number;
  slotsLeft: number;
  currentHoldingCount: number;
  maxPositions: number;
  stopLossPct: number;
  prefs?: Pick<
    InvestmentPrefs,
    "capital_krw" | "risk_profile" | "virtual_seed_capital" | "virtual_target_positions" | "split_count"
  >;
};

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
  targetPositions: number;
  targetWeightPct: number;
  minOrderAmount: number;
};

const MIN_ORDER_AMOUNT_KRW = 500_000;

function toPositiveNumber(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function resolveDefaultTargetPositions(riskProfile?: InvestmentPrefs["risk_profile"]): number {
  if (riskProfile === "active") return 10;
  if (riskProfile === "balanced") return 8;
  return 6;
}

function resolveRiskBudgetPct(riskProfile?: InvestmentPrefs["risk_profile"]): number {
  if (riskProfile === "active") return 0.0125;
  if (riskProfile === "balanced") return 0.01;
  return 0.0075;
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(value)));
}

function resolveSplitCount(raw?: number): number {
  return clampInt(raw ?? 3, 1, 5);
}

export function calculateAutoTradeBuySizing(
  input: AutoTradeSizingInput
): AutoTradeSizingResult {
  const availableCash = Math.max(0, Math.floor(input.availableCash));
  const price = Math.max(0, Math.floor(input.price));
  const slotsLeft = Math.max(1, Math.floor(input.slotsLeft));
  const currentHoldingCount = Math.max(0, Math.floor(input.currentHoldingCount));
  const maxPositions = Math.max(1, Math.floor(input.maxPositions));
  const stopLossPct = Math.max(0, Number(input.stopLossPct) || 0);

  const seedCapital =
    toPositiveNumber(input.prefs?.virtual_seed_capital) ??
    toPositiveNumber(input.prefs?.capital_krw) ??
    availableCash;

  const configuredTargetPositions = toPositiveNumber(input.prefs?.virtual_target_positions);
  const configuredSplitCount = resolveSplitCount(input.prefs?.split_count);
  const targetPositions = clampInt(
    configuredTargetPositions ?? resolveDefaultTargetPositions(input.prefs?.risk_profile),
    1,
    maxPositions
  );

  const remainingTargetSlots = Math.max(1, targetPositions - currentHoldingCount);
  const budgetPerSlot = Math.max(0, Math.floor(availableCash / slotsLeft));
  const budgetPerTargetPosition = Math.max(0, Math.floor(availableCash / remainingTargetSlots));

  const riskBudgetPct = resolveRiskBudgetPct(input.prefs?.risk_profile);
  const maxBudgetByRisk =
    seedCapital > 0 && stopLossPct > 0
      ? Math.max(0, Math.floor((seedCapital * riskBudgetPct) / (stopLossPct / 100)))
      : null;

  const candidateBudgets = [budgetPerSlot, budgetPerTargetPosition];
  if (maxBudgetByRisk && maxBudgetByRisk > 0) {
    candidateBudgets.push(maxBudgetByRisk);
  }
  const totalBudget = candidateBudgets.length ? Math.max(0, Math.min(...candidateBudgets)) : 0;
  let splitCount = configuredSplitCount;
  while (splitCount > 1 && Math.floor(totalBudget / splitCount) < MIN_ORDER_AMOUNT_KRW) {
    splitCount -= 1;
  }

  const budget = Math.max(0, Math.floor(totalBudget / splitCount));
  let quantity = price > 0 ? Math.max(0, Math.floor(budget / price)) : 0;
  let investedAmount = quantity > 0 ? quantity * price : 0;
  if (investedAmount > 0 && investedAmount < MIN_ORDER_AMOUNT_KRW) {
    quantity = 0;
    investedAmount = 0;
  }

  return {
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
    targetPositions,
    minOrderAmount: MIN_ORDER_AMOUNT_KRW,
    targetWeightPct:
      seedCapital > 0 && totalBudget > 0
        ? Number(((totalBudget / seedCapital) * 100).toFixed(2))
        : 0,
  };
}