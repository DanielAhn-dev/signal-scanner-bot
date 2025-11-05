/**
 * Anchored Volume Weighted Average Price (AVWAP)
 * @param prices 가격 배열
 * @param volumes 거래량 배열
 * @param anchorIdx 앵커 시작 인덱스
 * @returns AVWAP 배열
 */
export function avwap(
  prices: number[],
  volumes: number[],
  anchorIdx: number
): number[] {
  const result: number[] = Array(prices.length).fill(NaN);
  let cumulativePV = 0;
  let cumulativeV = 0;

  for (let i = anchorIdx; i < prices.length; i++) {
    cumulativePV += prices[i] * volumes[i];
    cumulativeV += volumes[i];
    result[i] = cumulativeV > 0 ? cumulativePV / cumulativeV : NaN;
  }

  return result;
}

/**
 * 다중 앵커 AVWAP 계산
 * @param prices 가격 배열
 * @param volumes 거래량 배열
 * @param anchors 앵커 인덱스 배열
 * @returns AVWAP 배열들
 */
export function multiAvwap(
  prices: number[],
  volumes: number[],
  anchors: number[]
): number[][] {
  return anchors.map((anchor) => avwap(prices, volumes, anchor));
}
