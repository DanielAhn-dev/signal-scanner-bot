import type { BacktestRiser, BacktestResponse } from '../types'
import { DEFAULT_VISIBLE_HORIZONS, EXTENDED_HORIZONS, HORIZONS, type Horizon } from '../constants'

export type SortKey = 'forwardReturnPct' | 'totalScore' | 'rsi14' | 'asof'
export type SortDir = 'asc' | 'desc'

export function sortRisers(risers: BacktestRiser[], sortKey: SortKey, sortDir: SortDir): BacktestRiser[] {
  const mult = sortDir === 'desc' ? -1 : 1
  return risers.slice().sort((a, b) => {
    if (sortKey === 'forwardReturnPct') return (a.forwardReturnPct - b.forwardReturnPct) * mult
    if (sortKey === 'totalScore') return (a.totalScore - b.totalScore) * mult
    if (sortKey === 'rsi14') return ((a.rsi14 ?? 0) - (b.rsi14 ?? 0)) * mult
    if (sortKey === 'asof') return a.asof.localeCompare(b.asof) * mult
    return 0
  })
}

export function computeVisibleHorizons(availableHorizons: number[] | undefined, horizon: Horizon): Horizon[] {
  const base = new Set<number>(DEFAULT_VISIBLE_HORIZONS)
  const available = new Set<number>((availableHorizons ?? []).map((h) => Number(h)))
  for (const h of EXTENDED_HORIZONS) {
    if (available.has(h)) base.add(h)
  }
  base.add(horizon)
  return HORIZONS.filter((h) => base.has(h))
}

export function hasExtendedHorizon(availableHorizons: number[] | undefined): boolean {
  const available = new Set<number>((availableHorizons ?? []).map((h) => Number(h)))
  return EXTENDED_HORIZONS.some((h) => available.has(h))
}

/** 표본이 너무 적은 특징(양쪽 중 작은 쪽 5건 미만)은 기본으로 숨긴다 */
export function filterFeatureStats(
  rows: NonNullable<BacktestResponse['featureStats']>,
  showAll: boolean,
): NonNullable<BacktestResponse['featureStats']> {
  if (showAll) return rows
  return rows.filter((row) => Math.min(row.baselineMatches, row.riserMatches) >= 5)
}

export function computeInvestSim(input: {
  baselineAvgReturnPct: number | undefined
  investAmount: number
  patternReturnPct: number | null
}) {
  if (input.investAmount <= 0) return null
  // 급등 종목 평균이 아니라 모든 과거 사례 평균 — 무작위로 샀을 때의 기준선
  const avgReturn = Number(input.baselineAvgReturnPct ?? 0)
  const patternReturn = input.patternReturnPct
  const avgGain = input.investAmount * (avgReturn / 100)
  const patternGain = patternReturn != null ? input.investAmount * (patternReturn / 100) : null
  return { avgGain, avgReturn, patternReturn, patternGain }
}
