import type { EconomicPhase } from './sectorMeta'

export type Sector = {
  id: string
  name: string
  score: number | null
  change_rate: number | null
  updated_at?: string | null
  metrics?: Record<string, any>
}

export type SectorLeader = {
  code: string
  name: string
  market: string | null
  market_cap: number | null
  liquidity: number | null
  is_sector_leader: boolean | null
}

export type Tab = "promising" | "next" | "all" | "guide"

export type MacroPhase = "normal" | "high_inflation" | "deflation" | "stagflation" | "unknown"

export type SectorMarketOverviewSnapshot = {
  economicPhase?: {
    phase?: MacroPhase
    label?: string
    severity?: number
    indicators?: {
      cpiYoy?: number | null
      us10y?: number | null
    }
  }
  tradingSignal?: {
    confidence?: number | null
  }
  diagnosis?: {
    riskScore?: number | null
  }
  fetchedAt?: string
}

export type PhaseDetectionResult = {
  phase: EconomicPhase | null
  confidence: number
  confidenceLabel: "높음" | "보통" | "낮음"
  basisLabel: string
  reason: string
}
