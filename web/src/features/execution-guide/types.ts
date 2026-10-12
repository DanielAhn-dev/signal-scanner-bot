export type RiskMode = 'conservative' | 'neutral' | 'aggressive'
export type CandidateMode = 'balanced' | 'multibagger' | 'swing'
export type ScoreVersion = 'v2' | 'legacy'

export type GuideRow = {
  code: string
  name: string
  score: number | null
  statusLabel: string | null
  summary: string | null
  entryLow: number | null
  entryHigh: number | null
  entryRef: number | null
  stopPrice: number | null
  target1: number | null
  target2: number | null
  target1Pct: number | null
  target2Pct: number | null
  holdDays: [number, number] | null
  riskReward: number | null
  warnings: string[]
  headlines: string[]
  headlineLinks: Array<{ title: string; url: string | null; source: string | null }>
  marketDataDate: string | null
  newsDataDate: string | null
  plannedBudget: number
  qty: number
  firstOrderAmount: number
}

export type AutoCandidate = {
  code: string
  name: string
  source: 'highlights' | 'scan'
  sector: string | null
  score: number
  scoreLegacy: number
  upsideSignal: number | null
  riskSignal: number | null
  confidencePct: number | null
  liquidity: number | null
  intradayChangePct: number | null
  netFlow5d: number | null
  netFlow20d: number | null
  reason: string
}
