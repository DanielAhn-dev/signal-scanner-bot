export type TradeRow = {
  id: string
  code: string
  stock_name?: string | null
  side: 'BUY' | 'SELL' | 'ADJUST'
  price: number
  quantity: number
  gross_amount: number
  net_amount?: number | null
  fee_amount?: number | null
  tax_amount?: number | null
  pnl_amount?: number | null
  buy_fee_amount?: number | null
  memo: string | null
  created_at: string
}

export type SellCandidate = {
  code: string
  name: string
  quantity: number
  buy_price: number
  /** 가격 없음(stocks.close가 비었거나 0)이면 null */
  current_price: number | null
  pct_change: number | null
}

export type OpStatus = 'idle' | 'loading' | 'done' | 'error'

export type JobPayload = {
  task?: string
  dry_run?: boolean
  step?: string
  chat_id?: number
  [key: string]: unknown
}

export type JobDetail = {
  id: string | number
  type: string
  status: string
  ok: boolean | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  payload: JobPayload | null
}

export type AutoTradeRun = {
  id: number
  run_type: string
  run_key: string
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED'
  summary?: {
    buys?: number
    sells?: number
    skipped?: number
    errors?: number
    buyCount?: number
    sellCount?: number
    skippedCount?: number
    errorCount?: number
    notes?: string[]
    [key: string]: unknown
  } | null
  started_at: string
  finished_at: string | null
}

export type TimelineEvent = {
  ts: string
  kind: 'queued' | 'running' | 'run_started' | 'trade' | 'run_finished' | 'job_finished'
  label: string
}

export type DryRunDetails = {
  buys: number
  sells: number
  skipped: number
  errors: number
  notes: string[]
}

export type JobSnapshot = {
  job: JobDetail
  latest_run: AutoTradeRun | null
  recent_runs: AutoTradeRun[]
  recent_trades: TradeRow[]
  timeline?: TimelineEvent[]
  dry_run_details?: DryRunDetails
}

export type OperationsKpi = {
  asof: string
  buy_count: number
  sell_count: number
  adjust_count: number
  trade_amount: number
  run_total: number
  run_success: number
  run_skipped: number
  run_failed: number
  queue_waiting: number
  holding_count: number
  latest_failed_reason?: string | null
  latest_failed_at?: string | null
  virtual_cash?: number | null
  virtual_seed_capital?: number | null
}

export type AutoCycleInsightFunnel = {
  initial: number
  policy: number
  base: number
  pool: number
  selected: number
}

export type AutoCycleInsightRun = {
  id: number
  run_type: string
  run_key: string
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED'
  started_at: string
  finished_at: string | null
  buys: number
  sells: number
  skipped: number
  errors: number
  top_reject_reasons: string[]
  key_gate_reasons: string[]
  funnel: AutoCycleInsightFunnel | null
  notes: string[]
  diagnosis_line: string
  diagnosis_breakdown: Array<{
    label: string
    count: number
    ratio: number
  }>
  compare_rows: Array<{
    code: string
    decision: 'BUY' | 'SKIP' | 'HOLD' | 'SELL' | 'ERROR'
    reason: string
    score: number | null
    trust_score: number | null
    min_trust_score: number | null
  }>
}

export type AutoCycleInsights = {
  latest: AutoCycleInsightRun | null
  recent_runs: AutoCycleInsightRun[]
  score_asof: string | null
  scan_top_rows: Array<{
    code: string
    name: string | null
    score: number
    signal: string | null
    exclusion_reason?: string | null
    reason_detail?: string | null
  }>
}

export type LiveJobState = 'queued' | 'running' | 'done' | 'failed'

export type NoteTag = {
  key: 'candidate' | 'reject' | 'risk' | 'policy' | 'execution' | 'other'
  label: string
  color: string
  bg: string
}
