import { scoreLeadAccumulationCandidate } from '../../../lib/accumulationSignal'
import type { ScanCandidate, SignalAgeMeta } from '../types'
import { computePriorityScore, computeQuickTradeScore } from './candidateScore'

export function isQuickTradeCandidate(item: ScanCandidate): boolean {
  const warn = String(item.warn_grade || '').toUpperCase().trim()
  if (warn === 'SELL') return false
  const entry = String(item.entry_grade || '').toUpperCase().trim()
  const trend = String(item.trend_grade || '').toUpperCase().trim()
  const hasQuality = entry === 'A' || entry === 'B' || trend === 'A' || trend === 'B'
  if (!hasQuality) return false
  const intraday = Number(item.intraday_change_pct ?? 0)
  if (Number.isFinite(intraday) && (intraday < -3.5 || intraday > 8.5)) return false
  if (Number(item.liquidity ?? 0) < 1_000_000_000) return false
  return computeQuickTradeScore(item) >= 58
}

export function isQuickTradeLiteCandidate(item: ScanCandidate): boolean {
  const warn = String(item.warn_grade || '').toUpperCase().trim()
  if (warn === 'SELL') return false
  const entry = String(item.entry_grade || '').toUpperCase().trim()
  const trend = String(item.trend_grade || '').toUpperCase().trim()
  const hasQuality = entry === 'A' || entry === 'B' || trend === 'A' || trend === 'B'
  if (!hasQuality) return false
  const intraday = Number(item.intraday_change_pct ?? 0)
  if (Number.isFinite(intraday) && (intraday < -5.5 || intraday > 10.5)) return false
  if (Number(item.liquidity ?? 0) < 3_000_000_000) return false
  return computeQuickTradeScore(item) >= 52
}

export function isDayStrategyCandidate(item: ScanCandidate): boolean {
  if (!isQuickTradeLiteCandidate(item)) return false
  const warn = String(item.warn_grade || '').toUpperCase().trim()
  if (warn === 'WARN' || warn === 'SELL') return false
  const intraday = Number(item.intraday_change_pct ?? 0)
  if (Number.isFinite(intraday) && (intraday < -1.5 || intraday > 4.5)) return false
  if (Number(item.liquidity ?? 0) < 3_000_000_000) return false
  return computeQuickTradeScore(item) >= 56
}

export function isOvernightStrategyCandidate(item: ScanCandidate, ageMeta?: SignalAgeMeta): boolean {
  const warn = String(item.warn_grade || '').toUpperCase().trim()
  if (warn === 'WARN' || warn === 'SELL') return false
  const entry = String(item.entry_grade || '').toUpperCase().trim()
  const trend = String(item.trend_grade || '').toUpperCase().trim()
  const hasQuality = entry === 'A' || entry === 'B' || trend === 'A' || trend === 'B'
  if (!hasQuality) return false
  const age = ageMeta?.quickLiteAgeDays
  if (age == null || age < 0 || age > 2) return false
  return Number(item.liquidity ?? 0) >= 1_000_000_000
}

export function isWeeklyStrategyCandidate(item: ScanCandidate): boolean {
  const warn = String(item.warn_grade || '').toUpperCase().trim()
  if (warn === 'SELL') return false
  const lead = scoreLeadAccumulationCandidate(item)
  const pivot = String(item.pivot_grade || '').toUpperCase().trim()
  const entry = String(item.entry_grade || '').toUpperCase().trim()
  const trend = String(item.trend_grade || '').toUpperCase().trim()
  const hasTrendBase = entry === 'A' || entry === 'B' || trend === 'A' || trend === 'B'
  if (!hasTrendBase) return false
  if (lead.stage === 'none' && lead.score < 60) return false
  if (pivot && !['A', 'B', 'C'].includes(pivot)) return false
  const intraday = Number(item.intraday_change_pct ?? 0)
  if (Number.isFinite(intraday) && Math.abs(intraday) > 6.5) return false
  return true
}

export function isCandidateStage(item: ScanCandidate): boolean {
  const warn = String(item.warn_grade || '').toUpperCase().trim()
  if (warn === 'SELL') return false
  const lead = scoreLeadAccumulationCandidate(item)
  if (lead.stage !== 'none' && lead.score >= 55) return true
  const dist = String(item.dist_grade || '').toUpperCase().trim()
  const pivot = String(item.pivot_grade || '').toUpperCase().trim()
  return ['A', 'B'].includes(dist) || ['A', 'B'].includes(pivot)
}

export function isConfirmStage(item: ScanCandidate): boolean {
  if (!isCandidateStage(item)) return false
  const entry = String(item.entry_grade || '').toUpperCase().trim()
  const trend = String(item.trend_grade || '').toUpperCase().trim()
  const pivot = String(item.pivot_grade || '').toUpperCase().trim()
  const hasTrendTurn = ['A', 'B'].includes(trend) || ['A', 'B'].includes(pivot)
  return ['A', 'B'].includes(entry) || hasTrendTurn
}

export function isBuycheckStage(item: ScanCandidate): boolean {
  if (!isConfirmStage(item)) return false
  const warn = String(item.warn_grade || '').toUpperCase().trim()
  if (!(warn === '' || warn === 'SAFE' || warn === 'WATCH')) return false
  const priority = computePriorityScore(item)
  return priority >= 55 || isQuickTradeLiteCandidate(item)
}
