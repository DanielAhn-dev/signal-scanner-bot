/**
 * MACD (Moving Average Convergence/Divergence)
 *
 * - MACD line   = EMA(fastPeriod) − EMA(slowPeriod)
 * - Signal line = EMA(signalPeriod) of MACD line
 * - Histogram   = MACD line − Signal line
 */

export interface MACDResult {
  /** MACD 라인 (EMA12 - EMA26) */
  macd: number[];
  /** 시그널 라인 (EMA9 of MACD) */
  signal: number[];
  /** 히스토그램 (MACD - Signal) */
  histogram: number[];
}

/** 최근 크로스 상태 */
export type MACDCross = "golden" | "dead" | null;

/** MACD 다이버전스 결과 */
export interface MACDDivergence {
  /** 상승 다이버전스: 주가 신저점 but 히스토그램 고점 (반등 신호) */
  bullish: boolean;
  /** 하락 다이버전스: 주가 신고점 but 히스토그램 저점 (하락 신호) */
  bearish: boolean;
}

/**
 * 지수이동평균 (EMA)
 * 첫 `period`개의 단순평균으로 시드 후 EMA 적용
 */
function ema(values: number[], period: number): number[] {
  const n = values.length;
  const result: number[] = Array(n).fill(NaN);
  if (n < period) return result;

  const k = 2 / (period + 1);

  // 초기 SMA 씨드
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result[period - 1] = sum / period;

  for (let i = period; i < n; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * MACD 계산
 * @param closes 종가 배열 (오래된 순)
 * @param fastPeriod 빠른 EMA 기간 (기본 12)
 * @param slowPeriod 느린 EMA 기간 (기본 26)
 * @param signalPeriod 시그널 EMA 기간 (기본 9)
 */
export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDResult {
  const n = closes.length;
  const nanArr = () => Array(n).fill(NaN) as number[];

  if (n < slowPeriod + signalPeriod) {
    return { macd: nanArr(), signal: nanArr(), histogram: nanArr() };
  }

  const emaFast = ema(closes, fastPeriod);
  const emaSlow = ema(closes, slowPeriod);

  // MACD 라인: slowPeriod-1 인덱스부터 유효
  const macdLine: number[] = nanArr();
  for (let i = slowPeriod - 1; i < n; i++) {
    if (Number.isFinite(emaFast[i]) && Number.isFinite(emaSlow[i])) {
      macdLine[i] = emaFast[i] - emaSlow[i];
    }
  }

  // 시그널 라인: MACD의 첫 유효값부터 EMA(signalPeriod) 적용
  const signalLine: number[] = nanArr();
  const macdStart = slowPeriod - 1;
  const signalStart = macdStart + signalPeriod - 1;

  if (n <= signalStart) {
    return { macd: macdLine, signal: signalLine, histogram: nanArr() };
  }

  const sigK = 2 / (signalPeriod + 1);
  let sigSum = 0;
  for (let i = 0; i < signalPeriod; i++) {
    sigSum += macdLine[macdStart + i];
  }
  signalLine[signalStart] = sigSum / signalPeriod;

  for (let i = signalStart + 1; i < n; i++) {
    signalLine[i] = macdLine[i] * sigK + signalLine[i - 1] * (1 - sigK);
  }

  // 히스토그램
  const histogram: number[] = macdLine.map((m, i) =>
    Number.isFinite(m) && Number.isFinite(signalLine[i]) ? m - signalLine[i] : NaN
  );

  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * 최근 MACD 골든/데드 크로스 감지 (최근 lookback 봉 내)
 * @param macdResult macd() 결과
 * @param lookback 탐색할 최근 봉 수 (기본 5)
 */
export function detectMACDCross(
  macdResult: MACDResult,
  lookback = 5
): MACDCross {
  const { macd: m, signal: s } = macdResult;
  const n = m.length;
  if (n < 2) return null;

  const start = Math.max(1, n - lookback);
  for (let i = n - 1; i >= start; i--) {
    if (!Number.isFinite(m[i]) || !Number.isFinite(s[i])) continue;
    if (!Number.isFinite(m[i - 1]) || !Number.isFinite(s[i - 1])) continue;

    const crossedUp = m[i - 1] < s[i - 1] && m[i] >= s[i];
    const crossedDown = m[i - 1] > s[i - 1] && m[i] <= s[i];

    if (crossedUp) return "golden";
    if (crossedDown) return "dead";
  }
  return null;
}

/**
 * MACD 히스토그램 다이버전스 감지
 *
 * 상승 다이버전스: 최근 종가 < 이전 구간 저점, 히스토그램 저점 > 이전 저점
 * 하락 다이버전스: 최근 종가 > 이전 구간 고점, 히스토그램 고점 < 이전 고점
 *
 * @param closes 종가 배열
 * @param histogram MACD 히스토그램
 * @param lookback 비교 구간 (기본 20)
 */
export function detectMACDDivergence(
  closes: number[],
  histogram: number[],
  lookback = 20
): MACDDivergence {
  const n = closes.length;
  if (n < lookback + 2) return { bullish: false, bearish: false };

  const recentCloses = closes.slice(-lookback);
  const recentHist = histogram.slice(-lookback);

  const lastClose = recentCloses[recentCloses.length - 1];
  const lastHist = recentHist[recentHist.length - 1];

  if (!Number.isFinite(lastHist)) return { bullish: false, bearish: false };

  // 마지막 봉 제외한 이전 구간
  const prevCloses = recentCloses.slice(0, -1);
  const prevHist = recentHist.slice(0, -1).filter(Number.isFinite);

  if (prevHist.length === 0) return { bullish: false, bearish: false };

  const prevMinClose = Math.min(...prevCloses);
  const prevMaxClose = Math.max(...prevCloses);
  const prevMinHist = Math.min(...prevHist);
  const prevMaxHist = Math.max(...prevHist);

  // 상승 다이버전스: 주가 신저점 돌파 + 히스토그램은 저점보다 높음
  const bullish = lastClose < prevMinClose && lastHist > prevMinHist;

  // 하락 다이버전스: 주가 신고점 돌파 + 히스토그램은 고점보다 낮음
  const bearish = lastClose > prevMaxClose && lastHist < prevMaxHist;

  return { bullish, bearish };
}
