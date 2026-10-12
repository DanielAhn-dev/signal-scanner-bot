import type { BacktestRiser, RuleFilter, StockIndicators } from '../types'
import { isBuySignal } from './signal'

export function matchesRuleFilter(indicator: StockIndicators, filter?: RuleFilter): boolean {
  if (!filter) return true
  const score = Number(indicator.total_score ?? 0)
  const signal = String(indicator.signal ?? '')
  const rsi = indicator.rsi14

  if (filter.scoreMin != null && score < filter.scoreMin) return false
  if (filter.buyOnly && !isBuySignal(signal)) return false
  if (filter.rsiMin != null && (rsi == null || rsi < filter.rsiMin)) return false
  if (filter.rsiMax != null && (rsi == null || rsi > filter.rsiMax)) return false
  return true
}

/** 종목 점검 탭: 서버가 준 규칙 키별로 현재 지표가 규칙을 충족하는지. 키 → 조건은 서버 규칙 정의의 사본이다. */
export function isRuleKeyMatched(
  key: string,
  indicators: Pick<StockIndicators, 'total_score' | 'signal' | 'rsi14'>,
): boolean {
  const score = indicators.total_score ?? 0
  const signal = indicators.signal ?? ''
  const rsi = indicators.rsi14
  const buy = isBuySignal(signal)

  if (key === 'rule_score70_buy') return score >= 70 && buy
  if (key === 'rule_score65_buy') return score >= 65 && buy
  if (key === 'rule_score60_buy') return score >= 60 && buy
  if (key === 'rule_score55_buy') return score >= 55 && buy
  if (key === 'rule_rsi30_80') return rsi != null && rsi >= 30 && rsi <= 80
  if (key === 'rule_rsi40_70') return rsi != null && rsi >= 40 && rsi <= 70
  if (key === 'rule_rsi45_65') return rsi != null && rsi >= 45 && rsi <= 65
  if (key === 'rule_score60_rsi40_70') return score >= 60 && rsi != null && rsi >= 40 && rsi <= 70
  if (key === 'rule_score55_rsi40_70') return score >= 55 && rsi != null && rsi >= 40 && rsi <= 70
  if (key === 'rule_buy_rsi45_65') return buy && rsi != null && rsi >= 45 && rsi <= 65
  if (key === 'rule_buy_rsi40_70') return buy && rsi != null && rsi >= 40 && rsi <= 70
  if (key === 'rule_score65_buy_rsi40_70') return score >= 65 && buy && rsi != null && rsi >= 40 && rsi <= 70
  if (key === 'rule_score70_buy_rsi45_65') return score >= 70 && buy && rsi != null && rsi >= 45 && rsi <= 65
  return false
}

/** 이벤트 샘플 중 규칙 필터를 통과하는 것만(입력 순서 유지) */
export function filterSamplesByRule(rows: BacktestRiser[], filter: RuleFilter): BacktestRiser[] {
  const { scoreMin, buyOnly, rsiMin, rsiMax } = filter
  return rows.filter((row) => {
    if (scoreMin != null && row.totalScore < scoreMin) return false
    if (buyOnly && !isBuySignal(row.signal)) return false
    if (rsiMin != null && (row.rsi14 == null || row.rsi14 < rsiMin)) return false
    if (rsiMax != null && (row.rsi14 == null || row.rsi14 > rsiMax)) return false
    return true
  })
}
