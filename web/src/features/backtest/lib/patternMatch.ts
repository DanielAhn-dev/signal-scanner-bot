import type { StockIndicators } from '../types'
import { isBuySignal } from './signal'

/** 종목 점검 탭의 3조건(점수 70+, BUY 계열, RSI 45~65) 일치 요약 */
export function buildPatternMatch(indicators: StockIndicators) {
  const score = indicators.total_score ?? 0
  const signal = indicators.signal ?? ''
  const rsi = indicators.rsi14 ?? 0
  const scoreMatch = score >= 70
  const buyMatch = isBuySignal(signal)
  const rsiMatch = rsi >= 45 && rsi <= 65
  return {
    score,
    signal,
    rsi,
    scoreMatch,
    buyMatch,
    rsiMatch,
    matchCount: [scoreMatch, buyMatch, rsiMatch].filter(Boolean).length,
    entryGrade: indicators.entry_grade,
    warnGrade: indicators.warn_grade,
    distPct: indicators.dist_pct,
    dataDate: indicators.score_date ?? indicators.indicator_date,
  }
}
