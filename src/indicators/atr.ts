/**
 * ATR (Average True Range) — 변동성 측정 지표
 *
 * True Range = max(High−Low, |High−Prev Close|, |Low−Prev Close|)
 * ATR = Wilder's Smoothing(TR, period)
 */

import type { StockOHLCV } from "../data/types";

/**
 * True Range 배열 계산
 */
export function trueRange(
  highs: number[],
  lows: number[],
  closes: number[]
): number[] {
  const n = highs.length;
  const result: number[] = Array(n).fill(NaN);

  for (let i = 0; i < n; i++) {
    const h = highs[i];
    const l = lows[i];
    const prevClose = i > 0 ? closes[i - 1] : closes[i];

    if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(prevClose)) {
      continue;
    }

    result[i] = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
  }

  return result;
}

/**
 * ATR (Wilder's Smoothing)
 * @param highs 고가 배열
 * @param lows 저가 배열
 * @param closes 종가 배열 (오래된 순)
 * @param period 기간 (기본 14)
 * @returns ATR 배열
 */
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number[] {
  const n = highs.length;
  const result: number[] = Array(n).fill(NaN);
  if (n < period + 1) return result;

  const tr = trueRange(highs, lows, closes);

  // 첫 ATR = 단순평균 TR (1번 인덱스부터: prev close 사용 가능)
  let sum = 0;
  for (let i = 1; i <= period; i++) {
    if (!Number.isFinite(tr[i])) return result;
    sum += tr[i];
  }

  result[period] = sum / period;

  // Wilder's Smoothing: ATR[i] = (ATR[i-1] * (period-1) + TR[i]) / period
  for (let i = period + 1; i < n; i++) {
    if (!Number.isFinite(tr[i])) {
      result[i] = result[i - 1];
      continue;
    }
    result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
  }

  return result;
}

/**
 * StockOHLCV 배열에서 ATR 계산 (편의 함수)
 * @returns { atr14: 최신 ATR, atrPct: ATR / 종가 * 100 }
 */
export function calcATR(
  data: StockOHLCV[],
  period = 14
): { atr14: number; atrPct: number } | null {
  if (data.length < period + 2) return null;

  const highs = data.map((d) => d.high);
  const lows = data.map((d) => d.low);
  const closes = data.map((d) => d.close);

  const atrArr = atr(highs, lows, closes, period);
  const lastIdx = data.length - 1;
  const atr14 = atrArr[lastIdx];
  const lastClose = closes[lastIdx];

  if (!Number.isFinite(atr14) || lastClose <= 0) return null;

  return {
    atr14,
    atrPct: (atr14 / lastClose) * 100,
  };
}

/**
 * ATR 기준 변동성 레벨
 * - low:    atrPct < 2%  → 저변동성
 * - normal: 2% ≤ atrPct < 4%
 * - high:   4% ≤ atrPct < 7%
 * - extreme: atrPct ≥ 7%
 */
export type VolatilityLevel = "low" | "normal" | "high" | "extreme";

export function getVolatilityLevel(atrPct: number): VolatilityLevel {
  if (atrPct < 2) return "low";
  if (atrPct < 4) return "normal";
  if (atrPct < 7) return "high";
  return "extreme";
}

/**
 * ATR 변동성에 따른 포지션 크기 조정 계수
 * 저변동성 → 1.1x, 보통 → 1.0x, 고변동성 → 0.7x, 극단 → 0.45x
 */
export function atrSizeAdjustment(atrPct: number): number {
  const level = getVolatilityLevel(atrPct);
  switch (level) {
    case "low":     return 1.1;
    case "normal":  return 1.0;
    case "high":    return 0.7;
    case "extreme": return 0.45;
  }
}
