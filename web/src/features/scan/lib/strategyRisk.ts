import type { StrategyRiskTier } from '../types'

export function getStrategyRiskTier(statusLabel: string | undefined): StrategyRiskTier {
  const label = String(statusLabel || '')
  if (label.includes('경고')) return 'warning'
  if (label.includes('주의')) return 'caution'
  return 'good'
}

export function getTierAdjustedPosition(baseR: number, tier: StrategyRiskTier): number {
  if (tier === 'warning') return Math.max(0.2, Math.round(baseR * 0.5 * 10) / 10)
  if (tier === 'caution') return Math.max(0.3, Math.round(baseR * 0.7 * 10) / 10)
  return Math.round(baseR * 10) / 10
}
