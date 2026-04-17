import type { StockOHLCV } from "../data/types";
import type { ScoreFactors } from "../score/engine";

const MIN_SCALE_TRIGGER = 0.55;
const MAX_SCALE_TRIGGER = 1.8;

function toFinitePositive(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

export function resolvePriceScaleFactor(
  referencePrice: unknown,
  baselinePrice: unknown
): number | null {
  const reference = toFinitePositive(referencePrice);
  const baseline = toFinitePositive(baselinePrice);
  if (!reference || !baseline) return null;

  const ratio = reference / baseline;
  if (ratio >= MIN_SCALE_TRIGGER && ratio <= MAX_SCALE_TRIGGER) {
    return null;
  }

  return ratio;
}

export function scaleSeriesToReferencePrice(
  series: StockOHLCV[],
  referencePrice: unknown
): StockOHLCV[] {
  if (!series.length) return series;

  const factor = resolvePriceScaleFactor(
    referencePrice,
    series[series.length - 1]?.close
  );
  if (!factor) return series;

  return series.map((item) => ({
    ...item,
    open: Math.round(item.open * factor),
    high: Math.round(item.high * factor),
    low: Math.round(item.low * factor),
    close: Math.round(item.close * factor),
    amount: Math.round(item.amount * factor),
    value: item.value != null ? Math.round(item.value * factor) : item.value,
  }));
}

export function scaleScoreFactorsToReferencePrice<T extends Partial<ScoreFactors>>(
  factors: T,
  referencePrice: unknown,
  baselinePrice: unknown
): T {
  const factor = resolvePriceScaleFactor(referencePrice, baselinePrice);
  if (!factor) return factors;

  return {
    ...factors,
    sma20: factors.sma20 != null ? factors.sma20 * factor : factors.sma20,
    sma50: factors.sma50 != null ? factors.sma50 * factor : factors.sma50,
    sma200: factors.sma200 != null ? factors.sma200 * factor : factors.sma200,
    sma200_slope:
      factors.sma200_slope != null
        ? factors.sma200_slope * factor
        : factors.sma200_slope,
  };
}