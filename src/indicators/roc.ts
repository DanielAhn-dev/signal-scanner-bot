/**
 * Rate of Change (ROC)
 * @param data 가격 배열
 * @param period 기간
 * @returns ROC 배열 (%)
 */
export function roc(data: number[], period: number): number[] {
  if (period <= 0 || period >= data.length) {
    return Array(data.length).fill(NaN);
  }

  const result: number[] = Array(data.length).fill(NaN);

  for (let i = period; i < data.length; i++) {
    const current = data[i];
    const previous = data[i - period];

    if (previous !== 0) {
      result[i] = ((current - previous) / previous) * 100;
    }
  }

  return result;
}
