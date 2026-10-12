import type { EconomicPhase, SectorNature } from './sectorMeta'

export const SECTORS_TTL = 60_000
export const LS_KEY = "ls_sectors_page"
export const ANALYZE_PENDING_CODE_KEY = "analyze_pending_code"
export const DEFAULT_LEADERS_CRITERIA = "is_sector_leader desc, market_cap desc, liquidity desc"

export const PHASE_CONFIDENCE_THRESHOLD = {
  high: 80,
  medium: 60,
  weakGapRatio: 0.12,
} as const

export const NATURE_COLORS: Record<SectorNature, string> = {
  cyclical:           "var(--color-orange-500)",
  defensive:          "var(--color-green-500)",
  interest_sensitive: "var(--color-brand)",
  growth:             "#9B59B6",
}
export const NATURE_BG: Record<SectorNature, string> = {
  cyclical:           "rgba(255,107,53,0.1)",
  defensive:          "rgba(0,180,147,0.1)",
  interest_sensitive: "rgba(0,96,255,0.1)",
  growth:             "rgba(155,89,182,0.1)",
}

export const PHASE_COLORS: Record<EconomicPhase, string> = {
  recovery:  "var(--color-green-500)",
  expansion: "var(--color-brand)",
  slowdown:  "var(--color-orange-500)",
  recession: "var(--color-red-500, #F04452)",
}
export const PHASE_BG: Record<EconomicPhase, string> = {
  recovery:  "rgba(0,180,147,0.08)",
  expansion: "rgba(0,96,255,0.08)",
  slowdown:  "rgba(255,107,53,0.08)",
  recession: "rgba(240,68,82,0.08)",
}
