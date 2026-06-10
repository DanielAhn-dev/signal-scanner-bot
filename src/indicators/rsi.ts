/**
 * RSI (Wilder's Smoothing)
 * @param closes 종가 배열
 * @param period 기간 (기본 14)
 * @returns RSI 배열
 */
export function rsiWilder(closes: number[], period: number = 14): number[] {
  if (closes.length < period + 1) {
    return Array(closes.length).fill(NaN);
  }

  const result: number[] = Array(closes.length).fill(NaN);
  const deltas = closes.map((c, i) => (i > 0 ? c - closes[i - 1] : 0));

  // 초기 평균 계산
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const delta = deltas[i];
    if (delta >= 0) {
      avgGain += delta;
    } else {
      avgLoss -= delta;
    }
  }

  avgGain /= period;
  avgLoss /= period;

  // Wilder's Smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const delta = deltas[i];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;

    // 가격 변동 없음(flat) → 중립 RSI 50, 상승만 있으면 100
    if (avgGain === 0 && avgLoss === 0) {
      result[i] = 50;
    } else if (avgLoss === 0) {
      result[i] = 100;
    } else {
      result[i] = 100 - 100 / (1 + avgGain / avgLoss);
    }
  }

  return result;
}
