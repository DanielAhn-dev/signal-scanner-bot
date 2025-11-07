// src/score/engine.ts
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

export function calculateScore(data: StockOHLCV[]): StockScore | null {
  try {
    if (!data || data.length < 200) return null;
    const sorted = [...data].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const closes = sorted.map((d) => d.close);
    const vols = sorted.map((d) => d.volume);
    const sma20Arr = sma(closes, 20);
    const sma50Arr = sma(closes, 50);
    const sma200Arr = sma(closes, 200);
    const lastIdx = closes.length - 1;
    const lastClose = closes[lastIdx];
    const s20 = sma20Arr[lastIdx] ?? 0,
      s50 = sma50Arr[lastIdx] ?? 0,
      s200 = sma200Arr[lastIdx] ?? 0;
    const s200Prev = sma200Arr[lastIdx - 1] ?? s200;
    const s200Slope = s200 - s200Prev;

    const rsi14 = rsiWilder(closes, 14)[lastIdx] ?? 50;
    const roc14 = roc(closes, 14)[lastIdx] ?? 0;
    const roc21 = roc(closes, 21)[lastIdx] ?? 0;

    const anchors = [0.2, 0.5, 0.8].map((p) =>
      Math.max(0, Math.floor(sorted.length * p) - 1)
    );

    const avwaps = anchors.map((a) => avwap(closes, vols, a));
    const avwap_support = avwaps.length
      ? (avwaps.filter((series) => {
          const lastAvwap = series[series.length - 1];
          return Number.isFinite(lastAvwap) && lastClose >= lastAvwap;
        }).length /
          avwaps.length) *
        100
      : 0;

    let score = 0;
    if (lastClose > s20) score += 3;
    if (lastClose > s50) score += 4;
    if (lastClose > s200) score += 5;
    if (s200Slope > 0) score += 3;
    if (rsi14 >= 50) score += 2;
    if (roc14 > 0) score += 2;
    if (roc21 >= 0) score += 1;
    score += Math.min(6, Math.max(0, avwap_support / 20));

    let signal: StockScore["signal"] = "none";
    if (score >= 18) signal = "buy";
    else if (score >= 12) signal = "hold";
    else if (score <= 6) signal = "sell";

    const recommendation =
      "엔트리(20SMA±3% AVWAP 재돌파·거래량+50%), 손절(−7~−8% 또는 50SMA/AVWAP 이탈), 익절(+20~25% 분할·트레일링)";

    return {
      code: sorted[lastIdx].code,
      date: sorted[lastIdx].date,
      score,
      factors: {
        sma20: s20,
        sma50: s50,
        sma200: s200,
        sma200_slope: s200Slope,
        rsi14,
        roc14,
        roc21,
        avwap_support,
      },
      signal,
      recommendation,
    };
  } catch {
    return null;
  }
}
