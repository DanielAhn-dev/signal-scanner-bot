export type BacktestRiser = {
  code: string
  name?: string
  asof: string
  totalScore: number
  signal: string
  rsi14: number | null
  forwardReturnPct: number
}

export type BacktestResponse = {
  params: { horizonBars: number; lookbackDays: number; rallyThresholdPct: number; topN: number }
  availableHorizons?: number[]
  horizonAvailability?: Record<string, number>
  baseline: { labelableEvents: number; score70RatePct: number; buySignalRatePct: number; avgForwardReturnPct?: number }
  riserSummary: { riserEvents: number; avgForwardReturnPct: number }
  commonFeatures: {
    score70RatePct: number
    score70LiftPct: number
    buySignalRatePct: number
    buySignalLiftPct: number
    rsi45to65RatePct: number
  }
  featureStats?: Array<{
    key: string
    label: string
    baselineMatches: number
    baselineRatePct: number
    riserMatches: number
    riserRatePct: number
    liftPct: number
    supportPct: number
  }>
  ruleCandidates?: Array<{
    key: string
    label: string
    supportPct: number
    liftPct: number
    precisionPct: number
    matchedEvents: number
    riserMatches: number
    /** 규칙에 맞은 모든 사례(급등 여부 무관)의 평균 수익 */
    matchedAvgReturnPct?: number
    filter?: {
      scoreMin?: number
      buyOnly?: boolean
      rsiMin?: number
      rsiMax?: number
    }
  }>
  risers: BacktestRiser[]
}

export type StockIndicators = {
  code: string
  name: string | null
  market: string | null
  close: number | null
  score_date: string | null
  total_score: number | null
  signal: string | null
  indicator_date: string | null
  rsi14: number | null
  roc21?: number | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
  pullback_date: string | null
  entry_grade: string | null
  warn_grade: string | null
  dist_pct: number | null
  per: number | null
  pbr: number | null
  roe: number | null
  debt_ratio: number | null
  market_cap: number | null
}

export type RuleFilter = {
  scoreMin?: number
  buyOnly?: boolean
  rsiMin?: number
  rsiMax?: number
}

export type AutoPickTier = 'now' | 'prepare' | 'watch'
export type ReturnProfileKey = 'strict' | 'conservative' | 'aggressive'

export type AutoPickItem = {
  code: string
  name: string
  score: number
  signal: string
  rsi14: number | null
  market: string | null
  warnGrade: string | null
  ruleMatched: boolean
  coreMatchCount: number
  edgeScore: number
  expectedReturnPct: number
  shortMomentumPct: number
  liquidity: number | null
  tier: AutoPickTier
}

export type ScanCandidateLite = {
  code: string
  name?: string
  intraday_change_pct?: number | null
  liquidity?: number | null
}

export type BacktestTab = 'summary' | 'check' | 'samples'

export type ConditionStats = {
  buySignalPct: number
  score50PlusPct: number
  rsi45_65Pct: number
  totalScanned: number
}
