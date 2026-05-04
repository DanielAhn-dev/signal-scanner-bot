/**
 * src/utils/realtimeIndicators.ts
 * 현재가 기반 기술지표 재계산
 * 
 * 마감 기준 데이터 + 현재가 등락률로부터
 * 현재 시점의 기술지표를 역산하는 유틸리티
 */

export interface RealtimeIndicatorInput {
  /**마감 종가 (기준일) */
  closePrice: number;
  /**현재가 */
  currentPrice: number;
  /**마감 기준 RSI14 */
  rsi14?: number;
  /**마감 기준 ROC14 (%) */
  roc14?: number;
  /**마감 기준 ROC21 (%) */
  roc21?: number;
  /**마감 기준 SMA20 */
  sma20?: number;
  /**마감 기준 SMA50 */
  sma50?: number;
  /**마감 기준 SMA200 */
  sma200?: number;
  /**마감 기준 거래량 */
  volume?: number;
  /**현재 거래량 (장중) */
  currentVolume?: number;
}

export interface RealtimeIndicatorOutput {
  /**현재가 기반 추정 RSI14 */
  estimatedRsi14: number;
  /**현재가 기반 추정 ROC14 (%) */
  estimatedRoc14: number;
  /**현재가 기반 추정 ROC21 (%) */
  estimatedRoc21: number;
  /**현재가 vs SMA20 비교 */
  aboveSma20: boolean;
  /**현재가 vs SMA50 비교 */
  aboveSma50: boolean;
  /**현재가 vs SMA200 비교 */
  aboveSma200: boolean;
  /**수급 강도 (거래량 기반) */
  volumeStrength: "weak" | "normal" | "strong";
  /**조정된 momentum_score (0-100) */
  adjustedMomentumScore: number;
  /**신뢰도 지표 (0-1) */
  confidence: number;
}

/**
 * 현재가 등락률로부터 추정 RSI 계산
 * 
 * 간단한 모델: 마감 RSI + 등락률 가중 조정
 * 실제 RSI는 14일 고가/저가 시계열 필요하지만,
 * 현재가 snapshot에서는 추정만 가능
 */
export function estimateRsi14(
  input: RealtimeIndicatorInput
): number {
  const baseRsi = input.rsi14 ?? 50;
  const changeRatePct = ((input.currentPrice - input.closePrice) / input.closePrice) * 100;

  // 변화율 3% 이상은 RSI에 영향 (최대 ±15점)
  const rsiAdjustment = Math.min(15, Math.max(-15, changeRatePct * 2));
  const estimated = baseRsi + rsiAdjustment;

  return Math.max(10, Math.min(90, estimated));
}

/**
 * 현재가 기반 추정 ROC 계산
 * 
 * ROC(%) = ((현재가 - N일전가) / N일전가) × 100
 * 마감가로부터 현재가로 변환
 */
export function estimateRoc(
  baseRoc: number | undefined,
  changeRatePct: number,
  rocDays: number
): number {
  if (baseRoc === undefined) return 0;

  // 마감 ROC에서 현재 변화율만 추가
  // 실제로는 N일전 고가/저가 시점도 다르지만, 근사로 반영
  const estimated = baseRoc + changeRatePct * (1 - rocDays / 14);
  return Number(estimated.toFixed(2));
}

/**
 * 현재가 기반 momentum score 재계산
 * 
 * daily_batch.py의 momentum_score 재계산 로직과 동일하게 적용
 * (RSI, ROC, MA 교차 등)
 */
export function calculateAdjustedMomentumScore(
  baseValue: number,
  baseRsi: number | undefined,
  baseRoc14: number | undefined,
  baseRoc21: number | undefined,
  sma20: number | undefined,
  sma50: number | undefined,
  currentPrice: number,
  closePrice: number,
  sectorChange: number = 0
): number {
  const changeRatePct = ((currentPrice - closePrice) / closePrice) * 100;

  // 베이스 점수에서 시작
  let score = baseValue;

  // 현재 RSI 추정
  const estimatedRsi = estimateRsi14({ 
    closePrice, 
    currentPrice, 
    rsi14: baseRsi 
  });
  
  // RSI 기반 조정 (45~65 구간이 최적)
  if (45 <= estimatedRsi && estimatedRsi <= 65) {
    // 이미 포함되었을 가능성 있으므로 보수적으로
    score += 5;
  } else if (estimatedRsi > 70) {
    // 과매수 경고
    score -= 5;
  } else if (estimatedRsi < 40) {
    // 과매도 기회
    score += 5;
  }

  // 현재가 기반 상승률 반영
  if (changeRatePct > 0) {
    score += Math.min(8, changeRatePct * 2);
  } else if (changeRatePct < -3) {
    score -= Math.min(8, Math.abs(changeRatePct) * 1.5);
  }

  // MA 위치 재계산
  if (sma20 && sma50) {
    if (currentPrice > sma20 && sma20 > sma50) {
      score += 5; // 이미 포함될 가능성 있으므로 보수적
    } else if (currentPrice < sma20) {
      score -= 3;
    }
  }

  // 섹터 변화 반영 (이미 포함되었을 가능성)
  if (sectorChange > 2) {
    score += 2;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * 메인 함수: 현재가 기반 지표 전체 계산
 */
export function calculateRealtimeIndicators(
  input: RealtimeIndicatorInput
): RealtimeIndicatorOutput {
  if (!input.closePrice || input.closePrice === 0) {
    return {
      estimatedRsi14: input.rsi14 ?? 50,
      estimatedRoc14: input.roc14 ?? 0,
      estimatedRoc21: input.roc21 ?? 0,
      aboveSma20: false,
      aboveSma50: false,
      aboveSma200: false,
      volumeStrength: "normal",
      adjustedMomentumScore: 50,
      confidence: 0,
    };
  }

  const changeRatePct = ((input.currentPrice - input.closePrice) / input.closePrice) * 100;

  // 기술지표 재계산
  const estimatedRsi14 = estimateRsi14(input);
  const estimatedRoc14 = estimateRoc(input.roc14, changeRatePct, 14);
  const estimatedRoc21 = estimateRoc(input.roc21, changeRatePct, 21);

  // MA 비교
  const aboveSma20 = input.sma20 ? input.currentPrice > input.sma20 : false;
  const aboveSma50 = input.sma50 ? input.currentPrice > input.sma50 : false;
  const aboveSma200 = input.sma200 ? input.currentPrice > input.sma200 : false;

  // 거래량 강도 (간단한 추정)
  let volumeStrength: "weak" | "normal" | "strong" = "normal";
  if (input.volume && input.currentVolume) {
    const volumeRatio = input.currentVolume / (input.volume / 6); // 6시간 기준
    if (volumeRatio > 1.5) {
      volumeStrength = "strong";
    } else if (volumeRatio < 0.5) {
      volumeStrength = "weak";
    }
  }

  // 신뢰도: 변화가 작을수록 높음 (±2% 이내 = 0.9+)
  const confidence = Math.max(0.5, 1 - Math.abs(changeRatePct) / 10);

  // Momentum 점수 재계산
  const adjustedMomentumScore = calculateAdjustedMomentumScore(
    50, // base
    input.rsi14,
    input.roc14,
    input.roc21,
    input.sma20,
    input.sma50,
    input.currentPrice,
    input.closePrice,
    0
  );

  return {
    estimatedRsi14: Number(estimatedRsi14.toFixed(2)),
    estimatedRoc14: Number(estimatedRoc14.toFixed(2)),
    estimatedRoc21: Number(estimatedRoc21.toFixed(2)),
    aboveSma20,
    aboveSma50,
    aboveSma200,
    volumeStrength,
    adjustedMomentumScore,
    confidence,
  };
}
