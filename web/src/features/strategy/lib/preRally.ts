export function getPreRallyBadge(input: { lift: number; win: number; mdd: number }): { label: string; color: string } {
  if (input.lift >= 5 && input.win >= 45) return { label: '추천', color: 'var(--color-success)' }
  if (input.mdd <= -15 || input.lift < 0) return { label: '주의', color: 'var(--color-warning)' }
  return { label: '관찰', color: 'var(--color-brand)' }
}

import type { PreRallyPattern, PreRallySortKey } from '../types'

export function sortPreRallyPatterns(patterns: PreRallyPattern[], key: PreRallySortKey): PreRallyPattern[] {
  const rows = patterns.slice()
  if (key === 'win') return rows.sort((a, b) => b.winRatePct - a.winRatePct)
  if (key === 'ret') return rows.sort((a, b) => b.avgForwardReturnPct - a.avgForwardReturnPct)
  if (key === 'samples') return rows.sort((a, b) => b.samples - a.samples)
  return rows.sort((a, b) => b.liftVsBasePct - a.liftVsBasePct)
}
