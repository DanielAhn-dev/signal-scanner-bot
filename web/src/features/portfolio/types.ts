export type PortfolioShareHistoryItem = {
  shareId: string
  url: string
  expiresAt: string
  createdAt?: string
  revokedAt?: string | null
  accessCount?: number
  lastAccessedAt?: string | null
}

export type AccountFolder = {
  key: string
  brokerName: string
  accountName: string
  count: number
}

export type AccountPolicy = {
  chat_id?: number
  broker_name: string
  account_name: string
  risk_profile: 'safe' | 'balanced' | 'active' | 'value-swing'
  max_positions: number | null
  daily_loss_limit_pct: number | null
  min_cash_reserve_pct: number | null
  add_entry_score_adjust: number
  partial_take_profit_adjust_pct: number
  stop_loss_pct: number | null
  take_profit_pct: number | null
}

export type AdvisorPerformanceData = {
  summary?: {
    trustScore?: number | null
    totalDecisions?: number
    linkedSellWinRatePct?: number | null
    linkedRealizedPnl?: number
  } | null
  recent?: Array<{
    code?: string
    action?: string
    confidence?: number | null
    reason_summary?: string | null
    trade?: { pnl_amount?: number | null } | null
  }>
} | null
