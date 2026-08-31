export type VirtualExecutionSide = "BUY" | "SELL";

export type VirtualExecutionPrice = {
  referencePrice: number;
  executionPrice: number;
  slippageBps: number;
  slippageAmount: number;
};

const DEFAULT_SLIPPAGE_BPS = 10;
const MAX_SLIPPAGE_BPS = 500;

function toFiniteNonNegative(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

export function resolveVirtualExecutionPrice(input: {
  referencePrice: number;
  side: VirtualExecutionSide;
  slippageBps?: number;
}): VirtualExecutionPrice {
  const referencePrice = Math.max(0, Math.floor(toFiniteNonNegative(input.referencePrice)));
  const requestedBps = toFiniteNonNegative(input.slippageBps, DEFAULT_SLIPPAGE_BPS);
  const slippageBps = Math.min(MAX_SLIPPAGE_BPS, requestedBps);
  const direction = input.side === "BUY" ? 1 : -1;
  const executionPrice = Math.max(
    0,
    Math.round(referencePrice * (1 + (direction * slippageBps) / 10_000))
  );

  return {
    referencePrice,
    executionPrice,
    slippageBps,
    slippageAmount: executionPrice - referencePrice,
  };
}