/**
 * API 응답 타입 정의 (공통)
 * 점진적으로 any를 제거하는 기준 파일
 */

// ── 섹터 ────────────────────────────────────────────────
export type SectorItem = {
  id: string | number
  name: string
  score: number | null
  change_rate: number | null
  metrics?: Record<string, unknown> | null
}

// ── 종목 ────────────────────────────────────────────────
export type StockScore = {
  code: string
  name: string
  total_score: number
  momentum_score: number | null
  liquidity_score: number | null
  value_score: number | null
  factors?: Record<string, unknown> | null
  asof?: string | null
}

// ── 스캔 후보 ────────────────────────────────────────────
export type ScanCandidate = {
  code: string
  name: string
  sector_id: string | null
  entry_grade: string | null
  trend_grade: string | null
  dist_grade: string | null
  warn_grade: string | null
  entry_score: number | null
  warn_score: number | null
  priority_score: number | null
  adaptive_score: number | null
  adaptive_adjustment: number | null
  adaptive_reasons: string[] | null
  intraday_change_pct: number | null
  entry_price: number | null
  stop_loss_price: number | null
  target_price: number | null
  liquidity: number | null
  trade_date: string | null
  stock_updated_at: string | null
}

// ── 보유 포지션 ──────────────────────────────────────────
export type PositionRow = {
  id: string | number
  code: string
  stock_name: string | null
  buy_price: number
  quantity: number
  status: 'holding' | 'interest' | 'watch' | 'closed' | string
  invested_amount: number | null
  buy_date: string | null
  current_price?: number | null
  unrealized_pnl?: number | null
  unrealized_pct?: number | null
  score?: number | null
  warn_flags?: Record<string, boolean> | null
}

// ── 거래 기록 ────────────────────────────────────────────
export type TradeRow = {
  id: string | number
  code: string
  stock_name: string | null
  side: 'BUY' | 'SELL' | 'ADJUST'
  price: number
  quantity: number
  gross_amount: number
  net_amount: number | null
  fee_amount: number | null
  tax_amount: number | null
  pnl_amount: number | null
  memo: string | null
  created_at: string
}

// ── 대시보드 요약 ─────────────────────────────────────────
export type DashboardSummary = {
  total_invested: number | null
  total_current_value: number | null
  total_unrealized_pnl: number | null
  total_realized_pnl: number | null
  position_count: number | null
  win_rate: number | null
  daily_pnl: number | null
  cash_balance: number | null
  last_updated: string | null
}

// ── 종목 분석 결과 ────────────────────────────────────────
export type AnalyzeResult = {
  code: string
  name: string
  current_price: number | null
  change_pct: number | null
  total_score: number | null
  momentum_score: number | null
  value_score: number | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
  sma240: number | null
  sma244: number | null
  ema20: number | null
  ema50: number | null
  ema200: number | null
  ema240: number | null
  ema244: number | null
  rsi14: number | null
  entry_price: number | null
  stop_loss_price: number | null
  target_price1: number | null
  target_price2: number | null
  risk_reward: number | null
  market: 'KOSPI' | 'KOSDAQ' | string | null
  sector_name: string | null
  per: number | null
  pbr: number | null
  foreign_ratio: number | null
  high52w: number | null
  low52w: number | null
  factors?: Record<string, unknown> | null
}

// ── OHLCV 캔들 ────────────────────────────────────────────
export type OhlcvCandle = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// ── 종목 수급 ────────────────────────────────────────────
export type FlowData = {
  code: string
  foreign_net: number | null
  institution_net: number | null
  retail_net: number | null
  date: string
}

// ── 어드바이저 ────────────────────────────────────────────
export type AdvisorResult = {
  status: 'strong_buy' | 'buy' | 'partial_sell' | 'watch' | 'sell' | string
  summary: string
  entry_price: number | null
  stop_loss: number | null
  target1: number | null
  target2: number | null
  risk_reward: number | null
  confidence: number | null
  reasons: string[]
}

// ── 포지션 유지보수 결과 ──────────────────────────────────
export type MaintenanceResult = {
  ok: boolean
  mode: 'watchreset' | 'holdingedit' | 'liquidateall' | 'holdingrestore' | string
  removed?: number
  soldCount?: number
  data?: PositionRow
  error?: string
}

// ── 공통 API 래퍼 ─────────────────────────────────────────
export type ApiResponse<T> = {
  data?: T
  error?: string
  ok?: boolean
}
