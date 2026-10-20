import type { EtfKey } from '../../lib/holdingAction'

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

/** 서버 positions 응답의 보유 행. 화면이 읽는 필드만 적었다(전부 선택값) */
export type HoldingRow = {
  id?: string | number
  position_type?: string
  account_kind?: string | null
  code?: string
  ticker?: string
  symbol?: string
  stock_name?: string | null
  /** stocks.product_type·etf_tax_class (없으면 이름 규칙으로 판정) */
  stock_product_type?: string | null
  stock_etf_tax_class?: string | null
  broker_name?: string | null
  account_name?: string | null
  quantity?: number
  avg_price?: number
  current_price?: number | null
  buy_price?: number
  buy_date?: string | null
  hold_days?: number | null
  unrealized_pnl?: number | null
  unrealized_pct?: number | null
  total_score?: number | null
  score_signal?: string | null
  entry_grade?: string | null
  trend_grade?: string | null
  warn_grade?: string | null
  warn_score?: number | null
  warn_overheat?: boolean
  warn_vol_spike?: boolean
  warn_atr_spike?: boolean
  warn_rsi_ob?: boolean
  warn_ma_break?: boolean
  warn_dead_cross?: boolean
  recommended_buy_qty?: number | null
  etf_key?: EtfKey | null
  weight_caution?: { level: 'caution' | 'strong'; message: string | null } | null
  entry_guard?: { label?: string; message?: string } | null
  entry_price_guide?: { verdict: 'ok' | 'caution' | 'stale'; gapPct: number; message: string } | null
  /** 실계좌 개별주: 매수일(기록일) 뒤 최고 종가 — src/lib/peakGiveback.ts */
  peak_since_buy?: { price: number; date: string } | null
  /** 실계좌 개별주: 마지막 매수 뒤 판 적이 있는가 (null = 모름) — src/lib/trimSinceBuy.ts */
  trimmed_since_buy?: boolean | null
  /** 이 종목 60일 변동성 ÷ KODEX 200 — 담을 크기 안내(src/lib/positionSizing.ts, C66) */
  sizing_vol_ratio?: number | null
  stock?: { close?: number | null; sector_id?: string | number | null; sector?: { id?: string | number; name?: string } | null } | null
  lots?: Array<{ acquired_quantity: number; acquired_price: number; acquired_at?: string | null }>
}
