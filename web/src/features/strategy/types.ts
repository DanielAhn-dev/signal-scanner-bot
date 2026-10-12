export type DecisionRow = {
  id?: number
  code?: string
  stock_name?: string
  action?: string
  created_at?: string
  strategy_version?: string | null
  market_regime?: string | null
  reason_summary?: string
  trigger_label?: string
  detail_lines?: string[]
  is_auto?: boolean
}

export type AutoTradeSettings = {
  is_enabled?: boolean
  selected_strategy?: string | null
  monday_buy_slots?: number
  max_positions?: number
  min_buy_score?: number
  take_profit_pct?: number
  stop_loss_pct?: number
  long_term_ratio?: number
}

export type ActivityRow = {
  id: string
  code: string
  stock_name?: string | null
  side: 'BUY' | 'SELL' | 'ADJUST'
  pnl_amount?: number | null
  created_at: string
  memo?: string | null
}

export type AdaptiveFactorStat = {
  key: string
  factor: string
  label: string
  sampleCount: number
  winRatePct: number
  avgForwardReturnPct: number
  weight: number
}

export type AdaptiveInsights = {
  latestTradeDate: string | null
  horizonBars: number
  sampleCount: number
  baseHitRatePct: number
  baseAvgReturnPct: number
  strengthScore: number
  todayBiasSummary: string
  topPositiveFactors: AdaptiveFactorStat[]
  topNegativeFactors: AdaptiveFactorStat[]
}

export type PreRallyPattern = {
  name: string
  samples: number
  winRatePct: number
  liftVsBasePct: number
  avgForwardReturnPct: number
  avgMaxDrawdownPct: number
}

export type PreRallyReport = {
  generatedAt?: string
  fileName?: string
  config?: {
    horizonBars?: number
    rallyThresholdPct?: number
  }
  dataset?: {
    labeledRows?: number
  }
  baseline?: {
    trainWinRatePct?: number
    testWinRatePct?: number
  }
  stablePatterns?: PreRallyPattern[]
  notes?: string[]
}

export type PreRallySortKey = 'lift' | 'win' | 'ret' | 'samples'

export type Tab = 'overview' | 'settings' | 'growth'
