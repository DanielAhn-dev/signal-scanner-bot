import type { ScanCandidate } from '../types'

export function getEntryLevel(grade: string | null | undefined): 'a' | 'b' | 'c' {
  const g = String(grade || '').toUpperCase()
  if (g === 'A') return 'a'
  if (g === 'B') return 'b'
  return 'c'
}

export function gradeScore(grade: string | null | undefined): number {
  if (!grade) return -1
  const g = String(grade).trim().toUpperCase()
  if (g === 'A') return 5
  if (g === 'B') return 4
  if (g === 'C') return 3
  if (g === 'D') return 2
  if (g === 'E') return 1
  return 0
}

/** 복합 우선순위 점수: entry_score × 20 − warn_score × 3 (범위 약 −18 ~ 80) */
export function computePriorityScore(item: ScanCandidate): number {
  if (typeof item.adaptive_score === 'number' && Number.isFinite(item.adaptive_score)) return item.adaptive_score
  return (item.entry_score ?? 0) * 20 - (item.warn_score ?? 0) * 3
}

export function clampScanValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function normalizeScanScoreToPct(raw: number | null | undefined): number {
  const safe = Number(raw ?? 0)
  if (!Number.isFinite(safe)) return 0
  if (safe > 5) return clampScanValue(safe, 0, 100)
  return clampScanValue(safe * 20, 0, 100)
}

export function computeQuickTradeScore(item: ScanCandidate): number {
  const entryPct = normalizeScanScoreToPct(item.entry_score)
  const warnPct = normalizeScanScoreToPct(item.warn_score)
  const safetyPct = 100 - warnPct
  const liquidity = Number(item.liquidity ?? 0)
  const liquidityScore =
    liquidity >= 80_000_000_000 ? 100 :
    liquidity >= 30_000_000_000 ? 85 :
    liquidity >= 10_000_000_000 ? 70 :
    liquidity >= 3_000_000_000 ? 55 :
    liquidity >= 1_000_000_000 ? 40 : 20
  const intraday = Number(item.intraday_change_pct ?? 0)
  const intradayFit = clampScanValue(100 - Math.abs(intraday - 1.8) * 18, 0, 100)
  return clampScanValue(
    entryPct * 0.46 +
    safetyPct * 0.16 +
    liquidityScore * 0.24 +
    intradayFit * 0.14,
    0,
    100,
  )
}
