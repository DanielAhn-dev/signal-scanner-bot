import { sma } from "../indicators/sma";
import { rsiWilder } from "../indicators/rsi";
import { roc } from "../indicators/roc";
import { avwap } from "../indicators/avwap";
import type { StockOHLCV } from "../data/types";

export interface ScoreFactors {
  sma20: number;
  sma50: number;
  sma200: number;
  sma200_slope: number;
  rsi14: number;
  roc14: number;
  roc21: number;
  avwap_support: number;
}

export interface StockScore {
  code: string;
  date: string;
  score: number;
  factors: ScoreFactors;
  signal: "buy" | "hold" | "sell" | "none";
  recommendation: string;
}

/**
 * 종목 점수화 엔진
 */
export function calculateScore(data: StockOHLCV[]): StockScore | null {
  try {
    if (!data || data.length < 200) {
      console.warn(
        `[Score] Insufficient data: ${data?.length || 0} (need 200+)`
      );
      return null;
    }

    // 데이터 정렬 (날짜 오름차순)
    const sortedData = [...data].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const closes = sortedData.map((d) => d.close);
    const volumes = sortedData.map((d) => d.volume);
    const lastIdx = closes.length - 1;
    const currentPrice = closes[lastIdx];

    console.log(
      `[Score] Data ready: ${closes.length} records, current price: ${currentPrice}`
    );

    // 지표 계산
    const sma20Arr = sma(closes, 20);
    const sma50Arr = sma(closes, 50);
    const sma200Arr = sma(closes, 200);
    const rsi14Arr = rsiWilder(closes, 14);
    const roc14Arr = roc(closes, 14);
    const roc21Arr = roc(closes, 21);

    console.log(`[Score] Indicators calculated:`, {
      sma20: sma20Arr[lastIdx],
      sma50: sma50Arr[lastIdx],
      sma200: sma200Arr[lastIdx],
      rsi14: rsi14Arr[lastIdx],
      roc14: roc14Arr[lastIdx],
      roc21: roc21Arr[lastIdx],
    });

    // 200일선 기울기 (최근 20일)
    const sma200_20 = sma200Arr[lastIdx - 20];
    const sma200_now = sma200Arr[lastIdx];
    const sma200Slope = sma200_now > sma200_20 ? 1 : -1;

    // AVWAP (최근 60일 앵커)
    const avwapArr = avwap(closes, volumes, Math.max(0, lastIdx - 60));
    const avwapValue = avwapArr[lastIdx] || 0;

    console.log(
      `[Score] Price: ${currentPrice}, SMA200: ${sma200_now}, AVWAP: ${avwapValue}`
    );

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

    // 🔥 수정: null 체크 추가
    const sma20 = sma20Arr[lastIdx] || 0;
    const sma50 = sma50Arr[lastIdx] || 0;
    const sma200 = sma200Arr[lastIdx] || 0;
    const rsi14 = rsi14Arr[lastIdx] || 50;
    const roc14 = roc14Arr[lastIdx] || 0;
    const roc21 = roc21Arr[lastIdx] || 0;

    // 1. 20일선 상회 (+5점)
    if (currentPrice > sma20 && sma20 > 0) {
      score += 5;
      factors.sma20 = 5;
    }

    // 2. 50일선 상회 (+10점)
    if (currentPrice > sma50 && sma50 > 0) {
      score += 10;
      factors.sma50 = 10;
    }

    // 3. 200일선 상회 (+15점)
    if (currentPrice > sma200 && sma200 > 0) {
      score += 15;
      factors.sma200 = 15;
    }

    // 4. 200일선 상승 추세 (+10점)
    if (sma200Slope > 0) {
      score += 10;
      factors.sma200_slope = 10;
    }

    // 5. RSI 40~70 구간 (+15점)
    if (rsi14 >= 40 && rsi14 <= 70) {
      score += 15;
      factors.rsi14 = 15;
    } else if (rsi14 > 70) {
      score += 5;
      factors.rsi14 = 5;
    }

    // 6. ROC14 양전환 (+15점)
    if (roc14 > 0) {
      score += 15;
      factors.roc14 = 15;
    }

    // 7. ROC21 0축 근처 (+10점)
    if (Math.abs(roc21) <= 3) {
      score += 10;
      factors.roc21 = 10;
    }

    // 8. AVWAP 지지 (+20점)
    if (
      avwapValue > 0 &&
      currentPrice > avwapValue &&
      currentPrice < avwapValue * 1.03
    ) {
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

    console.log(`[Score] Final: score=${score}, signal=${signal}`);

    return {
      code: sortedData[0].code,
      date: sortedData[lastIdx].date,
      score: Math.min(100, score),
      factors,
      signal,
      recommendation,
    };
  } catch (error) {
    console.error("[Score] Calculation error:", error);
    return null;
  }
}
