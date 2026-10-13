/**
 * 고점 대비 내준 폭 — 실계좌 개별주가 기록 뒤 최고가에서 얼마나 내려왔는지.
 *
 * 근거: C21(validate_exit_rules.py, 2015~2026 거래대금 상위 300, 60일 보유 대비). 추적손절 15%는 평균 수익을 잃지 않고
 * (안 +0.29%p·밖 +0.38%p, t < 0.4) 하위 5% 손실을 14.8%p·16.9%p 줄였다. 평균을 올리는 규칙이 아니라 큰 손실을 끊는 규칙이다.
 * "+30%였던 게 −30%가 되는" 왕복을 막는 용도. 지수 ETF에는 쓰지 않는다(지수는 팔지 않는 원칙).
 *
 * 한계: 고점은 매수일(앱에 기록한 날) 뒤 종가 기준이다. 실제로 산 날이 더 이르면 그 전 고점은 모른다.
 * 서버(handlers/ui/positions.ts)와 웹(보유 카드)이 같은 함수를 쓴다 — 순수 함수만 둔다.
 */

/** 고점 대비 이만큼(%) 내려오면 경고 (C21 추적 15%) */
export const PEAK_GIVEBACK_ALERT_PCT = -15;

export const PEAK_GIVEBACK_EVIDENCE = {
  rule: "추적손절 15%",
  period: "2015~2026",
  universe: "거래대금 상위 300종목(상장폐지 포함)",
  tailImprovementPp: [14.8, 16.9],
  meanDiffPp: [0.29, 0.38],
  generatedAt: "2026-10-06",
} as const;

export type PeakSinceBuy = { price: number; date: string };

/**
 * series: 날짜(YYYY-MM-DD)·종가. buyDate 당일부터 본다. currentPrice가 더 높으면 오늘이 고점.
 */
export function computePeakSinceBuy(
  series: Array<{ date: string; close: number }>,
  buyDate: string,
  currentPrice: number | null,
  today: string
): PeakSinceBuy | null {
  let peak: PeakSinceBuy | null = null;
  for (const p of series) {
    if (p.date < buyDate || !(p.close > 0)) continue;
    if (!peak || p.close > peak.price) peak = { price: p.close, date: p.date };
  }
  if (currentPrice != null && currentPrice > 0 && (!peak || currentPrice > peak.price)) {
    peak = { price: currentPrice, date: today };
  }
  return peak;
}

export type PeakGiveback = {
  peakGainPct: number;
  nowGainPct: number;
  fromPeakPct: number;
  alert: boolean;
};

/** 고점이 평단보다 높았던 경우만(내줄 수익이 있었던 경우) 계산한다 */
export function evaluatePeakGiveback(input: {
  avgPrice: number | null | undefined;
  currentPrice: number | null | undefined;
  peakPrice: number | null | undefined;
}): PeakGiveback | null {
  const { avgPrice, currentPrice, peakPrice } = input;
  if (!(avgPrice != null && avgPrice > 0 && currentPrice != null && currentPrice > 0 && peakPrice != null && peakPrice > 0)) return null;
  if (!(peakPrice > avgPrice)) return null;
  const fromPeakPct = (currentPrice / peakPrice - 1) * 100;
  return {
    peakGainPct: (peakPrice / avgPrice - 1) * 100,
    nowGainPct: (currentPrice / avgPrice - 1) * 100,
    fromPeakPct,
    alert: fromPeakPct <= PEAK_GIVEBACK_ALERT_PCT,
  };
}
