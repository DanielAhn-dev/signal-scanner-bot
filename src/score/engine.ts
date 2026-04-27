// score/engine.ts
import { sma } from "../indicators/sma";
import { rsiWilder } from "../indicators/rsi";
import { roc } from "../indicators/roc";
import { avwap } from "../indicators/avwap";
import { macd, detectMACDCross, detectMACDDivergence } from "../indicators/macd";
import { calcATR, atrSizeAdjustment } from "../indicators/atr";
import { calculateStableProSignal, type StableTurnType } from "../indicators/stablePro";
import { sanitizeOHLCV } from "../lib/validateOHLCV";
import type { StockOHLCV } from "../data/types";

export interface ScoreFactors {
  sma20: number;
  sma50: number;
  sma200: number;
  sma200_slope: number;
  rsi14: number;
  roc14: number;
  roc21: number;
  avwap_support: number; // 0~100 (%), 다중 앵커 AVWAP 위에 있는 비율
  avwap_regime?: "buyers" | "sellers" | "neutral"; // AVWAP 기준 매수/매도 레짐
  vol_ratio?: number; // 최근 거래량 / 20MA 거래량
  // MACD
  macd_cross?: "golden" | "dead" | null; // 최근 5봉 크로스
  macd_divergence_bullish?: boolean;     // 상승 다이버전스 (바닥 반전 신호)
  macd_divergence_bearish?: boolean;     // 하락 다이버전스
  // ATR 변동성
  atr14?: number;   // ATR 절대값
  atr_pct?: number; // ATR / 종가 * 100
  // 기관/외국인 수급
  institutional_score?: number;
  institutional_signal?: "accumulation" | "distribution" | "neutral";
  foreign_5d?: number;
  institution_5d?: number;
  foreign_consecutive_buy_days?: number;
  institution_consecutive_buy_days?: number;
  // Stable Pro (세력 평단 + 턴 신뢰도)
  stable_avg_price?: number;
  stable_support?: number;
  stable_box_high?: number;
  stable_box_low?: number;
  stable_above_avg?: boolean;
  stable_vol_ratio?: number;
  stable_turn?: StableTurnType;
  stable_turn_trust?: number;
  stable_accumulation?: boolean;
}

export interface MarketEnv {
  vix?: number;
  fearGreed?: number;
  usdkrw?: number;
  investorFlow?: {
    foreign5d?: number;
    institution5d?: number;
    foreignConsecutiveBuyDays?: number;
    institutionConsecutiveBuyDays?: number;
  };
}

export interface StockScore {
  code: string;
  date: string;
  score: number; // 0~100
  signal: "buy" | "hold" | "sell" | "none";
  factors: ScoreFactors;
  recommendation: string;

  // 실행 레벨/크기
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

export function calculateScore(
  data: StockOHLCV[],
  marketEnv?: MarketEnv
): StockScore | null {
  try {
    if (!data || data.length < 200) return null;

    // OHLCV 이상값 제거 후 날짜순 정렬
    const sorted = sanitizeOHLCV(data);
    if (sorted.length < 200) return null;
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

    // 대표 AVWAP(중간 앵커) 기준 매수/매도 레짐
    let avwap_regime: ScoreFactors["avwap_regime"] = "neutral";
    if (avwaps.length > 0) {
      const midSeries = avwaps[Math.floor(avwaps.length / 2)];
      const vNow = midSeries[lastIdx];
      const vPrev = midSeries[lastIdx - 1];
      if (Number.isFinite(vNow) && Number.isFinite(vPrev)) {
        const rising = vNow >= vPrev;
        if (lastClose > vNow && rising) avwap_regime = "buyers";
        else if (lastClose < vNow && !rising) avwap_regime = "sellers";
      }
    }

    // 보조 플래그
    const near20 = s20 > 0 && Math.abs((lastClose - s20) / s20) <= 0.03;
    const near50 = s50 > 0 && Math.abs((lastClose - s50) / s50) <= 0.03;
    const above50 = lastClose > s50;

    const vol20 =
      vols.slice(-20).reduce((a, b) => a + (b || 0), 0) /
      Math.max(1, Math.min(20, vols.length));
    const volSpike20 =
      Number.isFinite(vol20) && (vols[lastIdx] || 0) >= vol20 * 1.5;
    const vol_ratio =
      Number.isFinite(vol20) && vol20 > 0
        ? (vols[lastIdx] || 0) / vol20
        : undefined;

    // ── MACD ──
    const macdResult = macd(closes);
    const macd_cross = detectMACDCross(macdResult, 5);
    const macdDiv = detectMACDDivergence(closes, macdResult.histogram, 20);
    const macd_divergence_bullish = macdDiv.bullish;
    const macd_divergence_bearish = macdDiv.bearish;

    // ── ATR (변동성) ──
    const atrCalc = calcATR(sorted, 14);
    const atr14 = atrCalc?.atr14 ?? undefined;
    const atr_pct = atrCalc?.atrPct ?? undefined;

    // ── Stable Pro (세력 평단 + 턴 신뢰도) ──
    const stable = calculateStableProSignal(sorted, {
      volLen: 20,
      boxLen: 25,
      avgLen: 30,
      atrLen: 20,
    });
    const stableBullTurn = stable.turn === "bull-weak" || stable.turn === "bull-strong";
    const stableBearTurn = stable.turn === "bear-weak" || stable.turn === "bear-strong";

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

    // ── MACD 보정 ──
    // 골든 크로스: +5점, 데드 크로스: -5점
    if (macd_cross === "golden") score += 5;
    else if (macd_cross === "dead") score -= 5;
    // 상승 다이버전스 (바닥 반전 감지): +4점 — 저점 탈출 신호
    if (macd_divergence_bullish) score += 4;
    // 하락 다이버전스 (고점 반전 감지): -4점
    if (macd_divergence_bearish) score -= 4;

    // ── Stable Pro 보정 ──
    if (stable.turn === "bull-strong") score += 8;
    else if (stable.turn === "bull-weak") score += 4;
    else if (stable.turn === "bear-strong") score -= 9;
    else if (stable.turn === "bear-weak") score -= 5;

    if (stable.aboveAvg) score += 3;
    else score -= 3;

    if (stable.support > 0 && lastClose >= stable.support) score += 2;
    else if (stable.support > 0) score -= 4;

    if (stable.accumulation) score += 2;

    if (stable.trustScore >= 78) score += 3;
    else if (stable.trustScore <= 35) score -= 5;

    // ── 시장 환경 보정 (MarketEnv) ──
    let marketAdj = 0;
    let institutionalAdj = 0;
    let institutionalSignal: ScoreFactors["institutional_signal"] = "neutral";
    let foreign5d: number | undefined;
    let institution5d: number | undefined;
    let foreignConsecutiveBuyDays: number | undefined;
    let institutionConsecutiveBuyDays: number | undefined;
    if (marketEnv) {
      const { vix, fearGreed, usdkrw, investorFlow } = marketEnv;
      // VIX: 30+ → -12, 25-30 → -7, 20-25 → -3
      if (vix != null && Number.isFinite(vix)) {
        if (vix >= 30) marketAdj -= 12;
        else if (vix >= 25) marketAdj -= 7;
        else if (vix >= 20) marketAdj -= 3;
      }
      // CNN Fear & Greed: 극단적 공포(<=20) → 역발상 +5, 공포(<=35) → +2
      //                   극단적 탐욕(>=80) → -7, 탐욕(>=65) → -3
      if (fearGreed != null && Number.isFinite(fearGreed)) {
        if (fearGreed <= 20) marketAdj += 5;
        else if (fearGreed <= 35) marketAdj += 2;
        else if (fearGreed >= 80) marketAdj -= 7;
        else if (fearGreed >= 65) marketAdj -= 3;
      }
      // USD/KRW: 1400+ → 외국인 이탈 압력 -5, 1350+ → -2
      if (usdkrw != null && Number.isFinite(usdkrw)) {
        if (usdkrw >= 1400) marketAdj -= 5;
        else if (usdkrw >= 1350) marketAdj -= 2;
      }

      // 기관/외국인 수급 보정
      foreign5d = Number.isFinite(Number(investorFlow?.foreign5d))
        ? Number(investorFlow?.foreign5d)
        : undefined;
      institution5d = Number.isFinite(Number(investorFlow?.institution5d))
        ? Number(investorFlow?.institution5d)
        : undefined;
      foreignConsecutiveBuyDays = Number.isFinite(Number(investorFlow?.foreignConsecutiveBuyDays))
        ? Math.max(0, Math.floor(Number(investorFlow?.foreignConsecutiveBuyDays)))
        : undefined;
      institutionConsecutiveBuyDays = Number.isFinite(Number(investorFlow?.institutionConsecutiveBuyDays))
        ? Math.max(0, Math.floor(Number(investorFlow?.institutionConsecutiveBuyDays)))
        : undefined;

      if ((foreignConsecutiveBuyDays ?? 0) >= 5) institutionalAdj += 5;
      if ((institutionConsecutiveBuyDays ?? 0) >= 3) institutionalAdj += 3;

      // 매집 패턴: 가격 횡보 + 거래량 확대 + AVWAP 지지
      const accumulationPattern =
        Math.abs(roc21) <= 6 &&
        (vol_ratio ?? 0) >= 1.4 &&
        avwap_support >= 66;
      if (accumulationPattern) institutionalAdj += 4;

      // 분배 패턴: 외국인/기관 대규모 순매도
      if ((foreign5d ?? 0) <= -5_000_000_000) institutionalAdj -= 6;
      if ((institution5d ?? 0) <= -3_000_000_000) institutionalAdj -= 3;

      if (institutionalAdj >= 4) institutionalSignal = "accumulation";
      else if (institutionalAdj <= -4) institutionalSignal = "distribution";
    }
    institutionalAdj = Math.max(-10, Math.min(12, institutionalAdj));
    score += marketAdj + institutionalAdj;
    // 0~100 으로 클램프
    score = Math.max(0, Math.min(100, score));

    // 시그널
    const breakoutBuy =
      near20 && avwap_support >= 66 && volSpike20 && rsi14 >= 50 && roc14 >= 0;
    // 데드 크로스가 최근 발생했으면 추세 매수 억제
    const trendBuy =
      above50 &&
      rsi14 >= 55 &&
      roc21 >= 0 &&
      macd_cross !== "dead" &&
      stable.aboveAvg;

    let signal: StockScore["signal"] = "none";
    if ((breakoutBuy || trendBuy || stableBullTurn) && !stableBearTurn) signal = "buy";
    else if (stable.turn === "bear-strong") signal = score <= 45 ? "sell" : "hold";
    else if (score >= 35) signal = "hold";
    else if (score <= 15) signal = "sell";

    // 포지션 크기: 점수 기반 × ATR 변동성 조정
    const baseSize = lin(score, 20, 60, 0.6, 1.3);
    const atrAdj = atr_pct != null ? atrSizeAdjustment(atr_pct) : 1.0;
    const sizeFactor = Math.max(0.4, Math.min(1.5, baseSize * atrAdj));

    // === 실행 레벨 산출 (엔트리/손절/익절을 현재가가 아닌 기준가로 계산) ===

    // 기준 엔트리 가격: 조건에 따라 "어디에서 사야 좋은지" 제안
    let baseEntry = lastClose;

    if (breakoutBuy && s20 > 0) {
      // 돌파 매수: 20SMA 근처에서 진입 권장 (너무 멀리 가 있으면 20SMA+2% 수준 제안)
      const ideal = s20 * 1.02;
      baseEntry = near20 ? lastClose : Math.min(lastClose, ideal);
    } else if (trendBuy && s50 > 0) {
      // 추세 추종: 50SMA 되돌림에서 진입 권장
      const ideal = s50 * 1.01;
      baseEntry = near50 ? lastClose : Math.min(lastClose, ideal);
    }

    // 손절: ATR×2 기반 동적 손절 vs 고정 -7% vs 50SMA 중 가장 보수적(높은 값)
    const atrStop =
      atr14 != null && atr14 > 0 ? baseEntry - atr14 * 2 : baseEntry * 0.93;
    const fixedStop = baseEntry * 0.93;
    const smaStop = s50 > 0 ? s50 * 0.99 : baseEntry * 0.93;
    // 세 값 중 가장 높은 것(= 가장 촘촘한 손절)을 채택
    const hardStop = Math.max(atrStop, fixedStop, smaStop);

    // 트레일링 기준은 50SMA
    const trail50 = s50;

    // 익절: 엔트리 기준 +20%, +25%
    const t1 = baseEntry * 1.2;
    const t2 = baseEntry * 1.25;

    const recommendation =
      "엔트리(20SMA±3% AVWAP 재돌파·거래량+50% 또는 추세 기준), " +
      "손절(−7~−8% 또는 50SMA/AVWAP 이탈), 익절(+20~25% 분할·트레일링)";

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
        avwap_regime,
        vol_ratio,
        macd_cross,
        macd_divergence_bullish,
        macd_divergence_bearish,
        atr14,
        atr_pct,
        institutional_score: institutionalAdj,
        institutional_signal: institutionalSignal,
        foreign_5d: foreign5d,
        institution_5d: institution5d,
        foreign_consecutive_buy_days: foreignConsecutiveBuyDays,
        institution_consecutive_buy_days: institutionConsecutiveBuyDays,
        stable_avg_price: stable.avgPrice,
        stable_support: stable.support,
        stable_box_high: stable.boxHigh,
        stable_box_low: stable.boxLow,
        stable_above_avg: stable.aboveAvg,
        stable_vol_ratio: stable.volRatio,
        stable_turn: stable.turn,
        stable_turn_trust: stable.trustScore,
        stable_accumulation: stable.accumulation,
      },
      recommendation,
      entry: {
        buy: roundTo(baseEntry),
        add: above50 ? roundTo(s50) : undefined,
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
