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
  avwap_support: number; // 0~100 (%)
}

export interface StockScore {
  code: string;
  date: string;
  score: number; // 0~100
  signal: "buy" | "hold" | "sell" | "none";
  factors: ScoreFactors;
  recommendation: string;
  // 추가: 실행 레벨/크기
  entry?: { buy: number; add?: number };
  stops?: { hard: number; trail50?: number; trailPct?: number };
  targets?: { t1: number; t2: number };
  sizeFactor?: number; // 0.6~1.3 (기준 대비)
}

function lin(x: number, x0: number, x1: number, y0: number, y1: number) {
  if (!Number.isFinite(x)) return y0;
  if (x <= x0) return y0;
  if (x >= x1) return y1;
  return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
}

function roundTo(n: number, step = 1): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n / step) * step;
}

export function calculateScore(data: StockOHLCV[]): StockScore | null {
  try {
    if (!data || data.length < 200) return null;
    const sorted = [...data].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const closes = sorted.map((d) => d.close);
    const vols = sorted.map((d) => d.volume);
    const lastIdx = closes.length - 1;
    const lastClose = closes[lastIdx];
    const lastBar = sorted[lastIdx];

    // 이동평균
    const sma20Arr = sma(closes, 20);
    const sma50Arr = sma(closes, 50);
    const sma200Arr = sma(closes, 200);
    const s20 = sma20Arr[lastIdx] ?? 0;
    const s50 = sma50Arr[lastIdx] ?? 0;
    const s200 = sma200Arr[lastIdx] ?? 0;
    const s200Prev = sma200Arr[lastIdx - 1] ?? s200;
    const s200Slope = s200 - s200Prev;

    // 모멘텀
    const rsi14Arr = rsiWilder(closes, 14);
    const rsi14 = rsi14Arr[lastIdx] ?? 50;
    const roc14Arr = roc(closes, 14);
    const roc21Arr = roc(closes, 21);
    const roc14 = roc14Arr[lastIdx] ?? 0;
    const roc21 = roc21Arr[lastIdx] ?? 0;

    // AVWAP 지지: 과거 비율 앵커(20%, 50%, 80%)
    const anchors = [0.2, 0.5, 0.8].map((p) =>
      Math.max(0, Math.floor(sorted.length * p) - 1)
    );
    const avwaps = anchors.map((a) => avwap(closes, vols, a));
    const avwap_support = avwaps.length
      ? (avwaps.filter((series) => {
          const v = series[series.length - 1];
          return Number.isFinite(v) && lastClose >= v;
        }).length /
          avwaps.length) *
        100
      : 0;

    // 보조 플래그
    const near20 = s20 > 0 && Math.abs((lastClose - s20) / s20) <= 0.03;
    const above50 = lastClose > s50;
    const vol20 =
      vols.slice(-20).reduce((a, b) => a + (b || 0), 0) /
      Math.max(1, Math.min(20, vols.length));
    const volSpike20 =
      Number.isFinite(vol20) && (vols[lastIdx] || 0) >= vol20 * 1.5;

    // 점수 가중 (0~100)
    let score = 0;
    // AVWAP 지지 0~12점
    score += lin(avwap_support, 0, 100, 0, 12);
    // RSI 50~65 구간 0~10점
    score += lin(rsi14, 50, 65, 0, 10);
    // ROC21 0~6 → 0~8점
    score += lin(roc21, 0, 6, 0, 8);
    // ROC14 0~4 → 0~5점
    score += lin(roc14, 0, 4, 0, 5);
    // 50SMA 상회 기본 가점 5점
    score += above50 ? 5 : 0;
    // 200일 기울기: 양수면 최소 3점, 기울기 커질수록 6점까지
    const slopeScale = lin(s200Slope, 0, s200 * 0.005, 3, 6);
    score += Math.max(0, slopeScale);

    // 동시충족 보너스 (근접 20SMA, AVWAP 지지66+, 50SMA 상회, RSI55+, ROC21>0, 거래량스파이크)
    const combo =
      (near20 ? 1 : 0) +
      (avwap_support >= 66 ? 1 : 0) +
      (above50 ? 1 : 0) +
      (rsi14 >= 55 ? 1 : 0) +
      (roc21 > 0 ? 1 : 0) +
      (volSpike20 ? 1 : 0);
    if (combo >= 5) score += 10;
    else if (combo === 4) score += 7;
    else if (combo === 3) score += 4;

    // 시그널
    const breakoutBuy =
      near20 && avwap_support >= 66 && volSpike20 && rsi14 >= 50 && roc14 >= 0;
    const trendBuy = above50 && rsi14 >= 55 && roc21 >= 0;
    let signal: StockScore["signal"] = "none";
    if (breakoutBuy || trendBuy) signal = "buy";
    else if (score >= 35) signal = "hold";
    else if (score <= 15) signal = "sell";

    // 포지션 크기(기준 대비 0.6~1.3배)
    const sizeFactor = lin(score, 20, 60, 0.6, 1.3);

    // 실행 레벨 산출
    const buyPrice = near20 ? Math.min(lastClose, s20 * 1.03) : lastClose;
    const addPrice = above50 ? s50 : undefined;
    const hardStop = Math.min(s50 * 0.93, lastClose * 0.93);
    const trail50 = s50;
    const t1 = lastClose * 1.2;
    const t2 = lastClose * 1.25;

    const recommendation =
      "엔트리(20SMA±3% AVWAP 재돌파·거래량+50% 또는 추세 기준), 손절(−7~−8% 또는 50SMA/AVWAP 이탈), 익절(+20~25% 분할·트레일링)";

    return {
      code: lastBar.code,
      date: lastBar.date,
      score: Math.round(score * 10) / 10,
      signal,
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
      recommendation,
      entry: {
        buy: roundTo(buyPrice),
        add: addPrice ? roundTo(addPrice) : undefined,
      },
      stops: {
        hard: roundTo(hardStop),
        trail50: roundTo(trail50),
        trailPct: 0.08,
      },
      targets: { t1: roundTo(t1), t2: roundTo(t2) },
      sizeFactor: Math.round((sizeFactor + Number.EPSILON) * 10) / 10,
    };
  } catch {
    return null;
  }
}
