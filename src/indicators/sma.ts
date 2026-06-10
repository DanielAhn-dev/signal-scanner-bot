/**
 * Simple Moving Average (SMA)
 * @param data 가격 배열
 * @param period 기간
 * @returns SMA 배열
 */
export function sma(data: number[], period: number): number[] {
  if (period <= 0 || period > data.length) {
    return Array(data.length).fill(NaN);
  }

  const result: number[] = Array(data.length).fill(NaN);

  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    let valid = true;
    for (let j = 0; j < period; j++) {
      const v = data[i - j];
      if (!Number.isFinite(v)) { valid = false; break; }
      sum += v;
    }
    if (valid) result[i] = sum / period;
  }

  return result;
}
