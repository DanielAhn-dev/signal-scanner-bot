import { sma } from "../indicators/sma";
import { rsiWilder } from "../indicators/rsi";
import { roc } from "../indicators/roc";
import { avwap } from "../indicators/avwap";
import type { StockOHLCV } from "../data/types";

export interface ScoreFactors {
  sma20: number; // 현재가가 20일선 위/아래
  sma50: number; // 50일선
  sma200: number; // 200일선
  sma200_slope: number; // 200일선 기울기
  rsi14: number; // RSI(14)
  roc14: number; // ROC(14)
  roc21: number; // ROC(21)
  avwap_support: number; // AVWAP 지지 여부
}

export interface StockScore {
  code: string;
  date: string;
  score: number; // 0~100
  factors: ScoreFactors;
  signal: "buy" | "hold" | "sell" | "none";
  recommendation: string;
}

/**
 * 종목 점수화 엔진
 */
export function calculateScore(data: StockOHLCV[]): StockScore | null {
  if (data.length < 200) {
    console.warn("[Score] Insufficient data (need 200+ days)");
    return null;
  }

  const closes = data.map((d) => d.close);
  const volumes = data.map((d) => d.volume);
  const lastIdx = closes.length - 1;
  const currentPrice = closes[lastIdx];

  // 지표 계산
  const sma20Arr = sma(closes, 20);
  const sma50Arr = sma(closes, 50);
  const sma200Arr = sma(closes, 200);
  const rsi14Arr = rsiWilder(closes, 14);
  const roc14Arr = roc(closes, 14);
  const roc21Arr = roc(closes, 21);

  // 200일선 기울기 (최근 20일)
  const sma200Slope = sma200Arr[lastIdx] > sma200Arr[lastIdx - 20] ? 1 : -1;

  // AVWAP (최근 60일 앵커)
  const avwapArr = avwap(closes, volumes, lastIdx - 60);
  const avwapValue = avwapArr[lastIdx];

  // 점수 계산 (0~100)
  let score = 0;
  const factors: ScoreFactors = {
    sma20: 0,
    sma50: 0,
    sma200: 0,
    sma200_slope: 0,
    rsi14: 0,
    roc14: 0,
    roc21: 0,
    avwap_support: 0,
  };

  // 1. 20일선 상회 (+5점)
  if (currentPrice > sma20Arr[lastIdx]) {
    score += 5;
    factors.sma20 = 5;
  }

  // 2. 50일선 상회 (+10점)
  if (currentPrice > sma50Arr[lastIdx]) {
    score += 10;
    factors.sma50 = 10;
  }

  // 3. 200일선 상회 (+15점)
  if (currentPrice > sma200Arr[lastIdx]) {
    score += 15;
    factors.sma200 = 15;
  }

  // 4. 200일선 상승 추세 (+10점)
  if (sma200Slope > 0) {
    score += 10;
    factors.sma200_slope = 10;
  }

  // 5. RSI 40~70 구간 (+15점)
  const rsi = rsi14Arr[lastIdx];
  if (rsi >= 40 && rsi <= 70) {
    score += 15;
    factors.rsi14 = 15;
  } else if (rsi > 70) {
    score += 5; // 과열
    factors.rsi14 = 5;
  }

  // 6. ROC14 양전환 (+15점)
  if (roc14Arr[lastIdx] > 0) {
    score += 15;
    factors.roc14 = 15;
  }

  // 7. ROC21 0축 근처 (+10점)
  if (Math.abs(roc21Arr[lastIdx]) <= 3) {
    score += 10;
    factors.roc21 = 10;
  }

  // 8. AVWAP 지지 (+20점)
  if (currentPrice > avwapValue && currentPrice < avwapValue * 1.03) {
    score += 20;
    factors.avwap_support = 20;
  }

  // 신호 판단
  let signal: "buy" | "hold" | "sell" | "none" = "none";
  let recommendation = "";

  if (score >= 70) {
    signal = "buy";
    recommendation = "강력 매수 구간. 20일선 지지 확인 후 진입.";
  } else if (score >= 50) {
    signal = "hold";
    recommendation = "관심 종목. 추가 상승 모멘텀 대기.";
  } else if (score < 30) {
    signal = "sell";
    recommendation = "약세 구간. 손절 고려.";
  } else {
    recommendation = "중립. 추세 확인 필요.";
  }

  return {
    code: data[0].code,
    date: data[lastIdx].date,
    score: Math.min(100, score),
    factors,
    signal,
    recommendation,
  };
}
