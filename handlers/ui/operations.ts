import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'
import { denyIfUnauthorizedRead } from './_accessControl'
import { runVirtualAutoTradingCycle } from '../../src/services/virtualAutoTradeService'
import { replaceTradeLotsForHolding } from '../../src/services/virtualLotService'
import { parseStrategyMemo } from '../../src/lib/strategyMemo'
import { syncVirtualPortfolio } from '../../src/services/portfolioService'

type ActivityRow = {
  id: string
  code: string
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
  stock_name: string | null
}

type JobRow = {
  id: string
  type: string
  status: string
  ok: boolean | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  payload: Record<string, unknown> | null
}

type TimelineEvent = {
  ts: string
  kind: 'queued' | 'running' | 'run_started' | 'trade' | 'run_finished' | 'job_finished'
  label: string
}

type OpsDashboardKpi = {
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
  latest_failed_reason: string | null
  latest_failed_at: string | null
}

type AutoCycleInsightFunnel = {
  initial: number
  policy: number
  base: number
  pool: number
  selected: number
}

type AutoCycleInsightRun = {
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

type AutoCycleInsights = {
  latest: AutoCycleInsightRun | null
  recent_runs: AutoCycleInsightRun[]
  score_asof: string | null
  scan_top_rows: Array<{
    code: string
    name: string | null
    score: number
    signal: string | null
  }>
}

type ConsistencyIssue = {
  code: string
  name: string | null
  kind: 'mismatch' | 'missing_lots' | 'orphan_lots'
  position_id: number | null
  position_qty: number
  lot_qty: number
  detail: string
}

type AutoOnlyResetResult = {
  auto_trade_count: number
  auto_position_count: number
  auto_lot_count: number
  auto_lot_match_count: number
  autotrade_run_count: number
  autotrade_action_count: number
  decision_log_count: number
  snapshot_count: number
  sltp_execution_count: number
  strategy_gate_count: number
  realized_pnl_after_reset: number
}

function isAutoTradeMemo(memo?: string | null): boolean {
  const parsed = parseStrategyMemo(memo)
  return parsed.strategyId === 'core.autotrade.v1' || parsed.raw.startsWith('autotrade-')
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

async function resetAutoTradeOnlyData(
  supabase: SupabaseClient,
  chatId: string | number,
): Promise<AutoOnlyResetResult> {
  const chatIdNum = Number(chatId)
  if (!Number.isFinite(chatIdNum) || chatIdNum <= 0) {
    throw new Error('invalid chat_id')
  }

  const [tradesRes, positionsRes, lotsRes, runsRes, actionsRes, decisionsRes, snapshotsRes, sltpRes, gateRes] = await Promise.all([
    supabase
      .from('virtual_trades')
      .select('id,memo')
      .eq('chat_id', chatIdNum),
    supabase
      .from('virtual_positions')
      .select('id,memo')
      .eq('chat_id', chatIdNum),
    supabase
      .from('virtual_trade_lots')
      .select('id,note,source_trade_id')
      .eq('chat_id', chatIdNum),
    supabase
      .from('virtual_autotrade_runs')
      .select('id', { count: 'exact' })
      .eq('chat_id', chatIdNum),
    supabase
      .from('virtual_autotrade_actions')
      .select('id', { count: 'exact' })
      .eq('chat_id', chatIdNum),
    supabase
      .from('virtual_decision_logs')
      .select('id,linked_trade_id,strategy_id')
      .eq('chat_id', chatIdNum),
    supabase
      .from('portfolio_snapshots')
      .select('id', { count: 'exact' })
      .eq('chat_id', chatIdNum),
    supabase
      .from('stop_loss_take_profit_executions')
      .select('id', { count: 'exact' })
      .eq('chat_id', chatIdNum),
    supabase
      .from('virtual_strategy_gate_states')
      .select('chat_id', { count: 'exact' })
      .eq('chat_id', chatIdNum),
  ])

  if (tradesRes.error) throw new Error(tradesRes.error.message)
  if (positionsRes.error) throw new Error(positionsRes.error.message)
  if (lotsRes.error) throw new Error(lotsRes.error.message)
  if (decisionsRes.error) throw new Error(decisionsRes.error.message)

  const trades = Array.isArray(tradesRes.data) ? tradesRes.data : []
  const positions = Array.isArray(positionsRes.data) ? positionsRes.data : []
  const lots = Array.isArray(lotsRes.data) ? lotsRes.data : []
  const decisionLogs = Array.isArray(decisionsRes.data) ? decisionsRes.data : []

  const autoTradeIds = trades
    .filter((row) => isAutoTradeMemo(String((row as Record<string, unknown>)?.memo || '')))
    .map((row) => Number((row as Record<string, unknown>)?.id || 0))
    .filter((id) => Number.isFinite(id) && id > 0)

  const autoPositionIds = positions
    .filter((row) => isAutoTradeMemo(String((row as Record<string, unknown>)?.memo || '')))
    .map((row) => Number((row as Record<string, unknown>)?.id || 0))
    .filter((id) => Number.isFinite(id) && id > 0)

  const autoLotIds = lots
    .filter((row) => {
      const record = row as Record<string, unknown>
      const sourceTradeId = Number(record.source_trade_id || 0)
      const note = String(record.note || '').toLowerCase()
      return (Number.isFinite(sourceTradeId) && autoTradeIds.includes(sourceTradeId))
        || note.includes('autotrade')
    })
    .map((row) => Number((row as Record<string, unknown>)?.id || 0))
    .filter((id) => Number.isFinite(id) && id > 0)

  let autoLotMatchCount = 0
  if (autoTradeIds.length > 0 || autoLotIds.length > 0) {
    let query = supabase
      .from('virtual_trade_lot_matches')
      .select('id', { count: 'exact' })
      .limit(1)

    if (autoTradeIds.length > 0) query = query.in('trade_id', autoTradeIds)
    if (autoLotIds.length > 0) query = query.in('lot_id', autoLotIds)

    const matchCountRes = await query
    autoLotMatchCount = matchCountRes.count || 0
  }

  if (autoTradeIds.length > 0 || autoLotIds.length > 0) {
    if (autoTradeIds.length > 0) {
      const { error } = await supabase
        .from('virtual_trade_lot_matches')
        .delete()
        .in('trade_id', autoTradeIds)
      if (error) throw new Error(error.message)
    }

    if (autoLotIds.length > 0) {
      const { error } = await supabase
        .from('virtual_trade_lot_matches')
        .delete()
        .in('lot_id', autoLotIds)
      if (error) throw new Error(error.message)
    }
  }

  if (autoLotIds.length > 0) {
    const { error } = await supabase
      .from('virtual_trade_lots')
      .delete()
      .in('id', autoLotIds)
    if (error) throw new Error(error.message)
  }

  if (autoTradeIds.length > 0) {
    const { error } = await supabase
      .from('virtual_trades')
      .delete()
      .in('id', autoTradeIds)
    if (error) throw new Error(error.message)
  }

  if (autoPositionIds.length > 0) {
    const { error } = await supabase
      .from('virtual_positions')
      .delete()
      .in('id', autoPositionIds)
    if (error) throw new Error(error.message)
  }

  const autoDecisionIds = decisionLogs
    .filter((row) => {
      const record = row as Record<string, unknown>
      const strategyId = String(record.strategy_id || '').trim()
      const linkedTradeId = Number(record.linked_trade_id || 0)
      return strategyId === 'core.autotrade.v1' || autoTradeIds.includes(linkedTradeId)
    })
    .map((row) => Number((row as Record<string, unknown>)?.id || 0))
    .filter((id) => Number.isFinite(id) && id > 0)

  if (autoDecisionIds.length > 0) {
    const { error } = await supabase
      .from('virtual_decision_logs')
      .delete()
      .in('id', autoDecisionIds)
    if (error) throw new Error(error.message)
  }

  const [
    delActionsRes,
    delRunsRes,
    delSnapshotsRes,
    delSltpRes,
    delGateRes,
    resetSettingsRes,
  ] = await Promise.all([
    supabase
      .from('virtual_autotrade_actions')
      .delete()
      .eq('chat_id', chatIdNum)
      .select('id'),
    supabase
      .from('virtual_autotrade_runs')
      .delete()
      .eq('chat_id', chatIdNum)
      .select('id'),
    supabase
      .from('portfolio_snapshots')
      .delete()
      .eq('chat_id', chatIdNum)
      .select('id'),
    supabase
      .from('stop_loss_take_profit_executions')
      .delete()
      .eq('chat_id', chatIdNum)
      .select('id'),
    supabase
      .from('virtual_strategy_gate_states')
      .delete()
      .eq('chat_id', chatIdNum)
      .select('chat_id'),
    supabase
      .from('virtual_autotrade_settings')
      .update({
        last_monday_buy_at: null,
        last_daily_review_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('chat_id', chatIdNum),
  ])

  if (delActionsRes.error) throw new Error(delActionsRes.error.message)
  if (delRunsRes.error) throw new Error(delRunsRes.error.message)
  if (delSnapshotsRes.error) throw new Error(delSnapshotsRes.error.message)
  if (delSltpRes.error) throw new Error(delSltpRes.error.message)
  if (delGateRes.error) throw new Error(delGateRes.error.message)
  if (resetSettingsRes.error) throw new Error(resetSettingsRes.error.message)

  const remainingTradesRes = await supabase
    .from('virtual_trades')
    .select('side,pnl_amount')
    .eq('chat_id', chatIdNum)
    .eq('side', 'SELL')

  if (remainingTradesRes.error) throw new Error(remainingTradesRes.error.message)

  const realizedPnl = (Array.isArray(remainingTradesRes.data) ? remainingTradesRes.data : [])
    .reduce((sum, row) => sum + toFiniteNumber((row as Record<string, unknown>)?.pnl_amount, 0), 0)

  const userRes = await supabase
    .from('users')
    .select('prefs')
    .eq('tg_id', chatIdNum)
    .maybeSingle()

  if (userRes.error) throw new Error(userRes.error.message)
  const currentPrefs = (userRes.data?.prefs || {}) as Record<string, unknown>
  const nextPrefs: Record<string, unknown> = {
    ...currentPrefs,
    virtual_realized_pnl: Math.round(realizedPnl),
    virtual_shadow_mode: false,
  }

  delete nextPrefs.trade_freeze_reason
  delete nextPrefs.pacing_state
  delete nextPrefs.pacing_last_updated_at
  delete nextPrefs.last_auto_cycle_key
  delete nextPrefs.last_manual_cycle_key
  delete nextPrefs.last_cycle_summary

  const prefsUpdate = await supabase
    .from('users')
    .update({ prefs: nextPrefs })
    .eq('tg_id', chatIdNum)

  if (prefsUpdate.error) throw new Error(prefsUpdate.error.message)

  await syncVirtualPortfolio(chatIdNum, chatIdNum)

  return {
    auto_trade_count: autoTradeIds.length,
    auto_position_count: autoPositionIds.length,
    auto_lot_count: autoLotIds.length,
    auto_lot_match_count: autoLotMatchCount,
    autotrade_run_count: (Array.isArray(delRunsRes.data) ? delRunsRes.data.length : 0) || runsRes.count || 0,
    autotrade_action_count: (Array.isArray(delActionsRes.data) ? delActionsRes.data.length : 0) || actionsRes.count || 0,
    decision_log_count: autoDecisionIds.length,
    snapshot_count: (Array.isArray(delSnapshotsRes.data) ? delSnapshotsRes.data.length : 0) || snapshotsRes.count || 0,
    sltp_execution_count: (Array.isArray(delSltpRes.data) ? delSltpRes.data.length : 0) || sltpRes.count || 0,
    strategy_gate_count: (Array.isArray(delGateRes.data) ? delGateRes.data.length : 0) || gateRes.count || 0,
    realized_pnl_after_reset: Math.round(realizedPnl),
  }
}

function kstDayRangeIso(base = new Date()): { startIso: string; endIso: string; ymd: string } {
  const utcMs = base.getTime() + base.getTimezoneOffset() * 60 * 1000
  const kst = new Date(utcMs + 9 * 60 * 60 * 1000)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(kst.getUTCDate()).padStart(2, '0')
  const startUtc = new Date(Date.UTC(y, kst.getUTCMonth(), kst.getUTCDate(), -9, 0, 0))
  const endUtc = new Date(Date.UTC(y, kst.getUTCMonth(), kst.getUTCDate() + 1, -9, 0, 0))
  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
    ymd: `${y}-${m}-${d}`,
  }
}

function extractFunnelFromNotes(notes: string[]): AutoCycleInsightFunnel | null {
  const line = notes.find((note) => note.includes('후보 필터링: 초기') || note.includes('추가매수 필터링: 초기'))
  if (!line) return null

  const match = line.match(/초기\s*(\d+)건\s*->\s*정책\s*(\d+)건\s*->\s*기본\s*(\d+)건\s*->\s*후보\s*(\d+)건\s*->\s*최종\s*(\d+)건/)
  if (!match) return null

  return {
    initial: Number(match[1] || 0),
    policy: Number(match[2] || 0),
    base: Number(match[3] || 0),
    pool: Number(match[4] || 0),
    selected: Number(match[5] || 0),
  }
}

function extractTopRejectReasons(notes: string[]): string[] {
  const line = notes.find((note) => note.includes('후보 탈락 상위:') || note.includes('추가매수 탈락 상위:'))
  if (!line) return []

  const payload = line.split(':').slice(1).join(':').trim()
  if (!payload) return []
  return payload
    .split('·')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3)
}

function extractKeyGateReasons(notes: string[]): string[] {
  const reasonMatchers: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /신규\/추가 매수 차단: 일손실 한도 도달|신규 매수 차단: 일손실 한도 도달|일손실 한도 도달/, label: '일손실 한도 도달' },
    { pattern: /투자 가능 현금 0원/, label: '투자 가능 현금 부족' },
    { pattern: /현금 하한 유지 구간/, label: '현금 리저브 하한 유지' },
    { pattern: /추가 매수 슬롯 없음|신규 매수 불가: 추가 매수 슬롯 0건|매수 슬롯 없음/, label: '매수 슬롯 부족' },
    { pattern: /매수 후보 없음|신규 매수 후보 0건/, label: '후보 없음(필터/점수/신호)' },
    { pattern: /signal-gate|신뢰도 .*점 < 기준/, label: '신뢰도 게이트 미통과' },
    { pattern: /복구모드/, label: '복구모드로 신규매수 차단' },
    { pattern: /장중 외 시간 스킵/, label: '장중 시간 외 실행' },
  ]

  const out: string[] = []
  for (const matcher of reasonMatchers) {
    if (notes.some((note) => matcher.pattern.test(note))) {
      out.push(matcher.label)
    }
  }
  return out.slice(0, 4)
}

function reasonLabel(reason: string): string {
  const normalized = String(reason || '').trim().toLowerCase()
  const map: Record<string, string> = {
    'signal-gate-reject': '신뢰도 게이트 미통과',
    'add-on-signal-gate-reject': '추가매수 신뢰도 게이트 미통과',
    'rebalance-signal-gate-reject': '리밸런싱 신뢰도 게이트 미통과',
    'daily-loss-limit-reached': '일손실 한도 도달',
    'no-available-cash': '투자 가능 현금 부족',
    'cash-reserve-floor': '현금 리저브 하한 유지',
    'no-candidates': '후보 없음',
    'no-buy-slots': '매수 슬롯 없음',
    'insufficient-cash': '주문 가능 금액 부족',
    'duplicate-window': '동일 실행창 중복 스킵',
    'duplicate-execution': '중복 체결 방지',
  }
  return map[normalized] || (normalized ? normalized.replace(/-/g, ' ') : '사유 없음')
}

function extractNumericDetail(detail: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(detail[key])
    if (Number.isFinite(value)) return value
  }
  return null
}

function extractSignalTrustFromDetail(detail: Record<string, unknown>): {
  trustScore: number | null
  minTrustScore: number | null
} {
  const signalTrust = detail.signalTrust as Record<string, unknown> | undefined
  const trustScore = signalTrust
    ? extractNumericDetail(signalTrust, ['score', 'trustScore'])
    : extractNumericDetail(detail, ['trustScore', 'signalTrustScore'])

  const minTrustScore = extractNumericDetail(detail, ['minTrustScore'])
  return { trustScore, minTrustScore }
}

function buildDiagnosisLine(input: {
  run: { buys: number; sells: number; skipped: number; errors: number }
  notes: string[]
  compareRows: AutoCycleInsightRun['compare_rows']
}): string {
  if (input.run.errors > 0) {
    return `오류 ${input.run.errors}건 발생으로 실행 품질이 저하되었습니다. 오류 상세를 우선 점검하세요.`
  }

  if (input.run.buys === 0 && input.run.sells === 0 && input.run.skipped === 0) {
    return '실행은 되었지만 액션 로그가 없어 대상 사용자/실행 조건을 먼저 확인해야 합니다.'
  }

  if (input.run.buys === 0) {
    const gateLine = input.notes.find((note) =>
      /일손실 한도 도달|투자 가능 현금 0원|현금 하한 유지 구간|매수 후보 없음|신규 매수 후보 0건|매수 슬롯/i.test(note)
    )
    if (gateLine) {
      return `이번 실행은 매수 0건입니다. 주된 원인: ${gateLine}`
    }

    const topBlocked = input.compareRows
      .filter((row) => row.decision === 'SKIP')
      .reduce<Record<string, number>>((acc, row) => {
        acc[row.reason] = (acc[row.reason] || 0) + 1
        return acc
      }, {})
    const top = Object.entries(topBlocked).sort((a, b) => b[1] - a[1])[0]
    if (top) {
      return `이번 실행은 매수 0건입니다. 주된 차단: ${top[0]} (${top[1]}건)`
    }

    return '이번 실행은 매수 0건입니다. 후보/신뢰도/자금 게이트 중 한 곳에서 모두 차단되었습니다.'
  }

  return `이번 실행은 매수 ${input.run.buys}건, 매도 ${input.run.sells}건이 반영되었습니다.`
}

function buildDiagnosisBreakdown(input: {
  notes: string[]
  compareRows: AutoCycleInsightRun['compare_rows']
}): Array<{ label: string; count: number; ratio: number }> {
  const counter = new Map<string, number>()

  const add = (label: string, value = 1) => {
    counter.set(label, (counter.get(label) || 0) + value)
  }

  for (const row of input.compareRows) {
    if (row.decision !== 'SKIP' && row.decision !== 'ERROR') continue
    const reason = String(row.reason || '')
    if (/신뢰도/i.test(reason)) add('신뢰도 게이트')
    else if (/현금|자금|주문 가능 금액/i.test(reason)) add('자금/현금')
    else if (/슬롯|복구모드|일손실/i.test(reason)) add('리스크/정책')
    else if (/후보 없음/i.test(reason)) add('후보 부족')
    else add('기타')
  }

  for (const note of input.notes) {
    if (/매수 후보 없음|신규 매수 후보 0건/i.test(note)) add('후보 부족')
    if (/일손실 한도 도달|복구모드|매수 슬롯 없음/i.test(note)) add('리스크/정책')
    if (/투자 가능 현금 0원|현금 하한 유지 구간|현금 부족/i.test(note)) add('자금/현금')
    if (/신뢰도 .*점 < 기준|signal-gate/i.test(note)) add('신뢰도 게이트')
  }

  const total = Array.from(counter.values()).reduce((sum, value) => sum + value, 0)
  if (total <= 0) return []

  return Array.from(counter.entries())
    .map(([label, count]) => ({
      label,
      count,
      ratio: Number(((count / total) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

async function getScanTopRows(
  supabase: SupabaseClient,
  limit = 12,
): Promise<{ scoreAsof: string | null; rows: AutoCycleInsights['scan_top_rows'] }> {
  const { data: asofRows, error: asofError } = await supabase
    .from('scores')
    .select('asof')
    .order('asof', { ascending: false })
    .limit(1)

  if (asofError) throw new Error(asofError.message)
  const scoreAsof = String((asofRows?.[0] as Record<string, unknown> | undefined)?.asof || '').trim() || null
  if (!scoreAsof) {
    return { scoreAsof: null, rows: [] }
  }

  const { data: scoreRows, error: scoreError } = await supabase
    .from('scores')
    .select('code,total_score,signal')
    .eq('asof', scoreAsof)
    .order('total_score', { ascending: false })
    .limit(limit)

  if (scoreError) throw new Error(scoreError.message)

  const rows = (Array.isArray(scoreRows) ? scoreRows : []) as Array<Record<string, unknown>>
  const codes = rows.map((row) => String(row.code || '').trim()).filter(Boolean)
  let nameMap: Record<string, string> = {}

  if (codes.length > 0) {
    const { data: stockRows } = await supabase
      .from('stocks')
      .select('code,name')
      .in('code', codes)

    if (Array.isArray(stockRows)) {
      nameMap = stockRows.reduce((acc, current) => {
        const code = String((current as Record<string, unknown>)?.code || '').trim()
        const name = String((current as Record<string, unknown>)?.name || '').trim()
        if (code) acc[code] = name
        return acc
      }, {} as Record<string, string>)
    }
  }

  return {
    scoreAsof,
    rows: rows.map((row) => {
      const code = String(row.code || '').trim()
      return {
        code,
        name: nameMap[code] || null,
        score: Number(row.total_score || 0),
        signal: String(row.signal || '').trim() || null,
      }
    }),
  }
}

async function enrichAutoCycleInsightRun(
  supabase: SupabaseClient,
  chatId: string | number,
  base: AutoCycleInsightRun,
): Promise<AutoCycleInsightRun> {
  const { data, error } = await supabase
    .from('virtual_autotrade_actions')
    .select('code,action_type,reason,detail,created_at')
    .eq('chat_id', chatId)
    .eq('run_id', base.id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return {
      ...base,
      diagnosis_line: buildDiagnosisLine({ run: base, notes: base.notes, compareRows: [] }),
      diagnosis_breakdown: [],
      compare_rows: [],
    }
  }

  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>
  const compareRows = rows
    .filter((row) => {
      const actionType = String(row.action_type || '').toUpperCase()
      const code = String(row.code || '').trim()
      return Boolean(code) && ['BUY', 'SKIP', 'HOLD', 'SELL', 'ERROR'].includes(actionType)
    })
    .map((row) => {
      const detail = (row.detail || {}) as Record<string, unknown>
      const { trustScore, minTrustScore } = extractSignalTrustFromDetail(detail)
      const score = extractNumericDetail(detail, ['score'])
      const actionType = String(row.action_type || '').toUpperCase() as 'BUY' | 'SKIP' | 'HOLD' | 'SELL' | 'ERROR'
      return {
        code: String(row.code || '').trim(),
        decision: actionType,
        reason: reasonLabel(String(row.reason || '')),
        score,
        trust_score: trustScore,
        min_trust_score: minTrustScore,
      }
    })
    .sort((a, b) => {
      const scoreDiff = (b.score ?? -1) - (a.score ?? -1)
      if (scoreDiff !== 0) return scoreDiff
      return (b.trust_score ?? -1) - (a.trust_score ?? -1)
    })
    .slice(0, 12)

  const diagnosis = buildDiagnosisLine({
    run: base,
    notes: base.notes,
    compareRows,
  })

  return {
    ...base,
    diagnosis_line: diagnosis,
    diagnosis_breakdown: buildDiagnosisBreakdown({ notes: base.notes, compareRows }),
    compare_rows: compareRows,
  }
}

function toAutoCycleInsightRun(row: Record<string, unknown>): AutoCycleInsightRun {
  const summary = (row.summary || {}) as Record<string, unknown>
  const notes = Array.isArray(summary.notes)
    ? summary.notes.map((v) => String(v || '').trim()).filter(Boolean)
    : []

  return {
    id: Number(row.id || 0),
    run_type: String(row.run_type || ''),
    run_key: String(row.run_key || ''),
    status: String(row.status || 'SKIPPED').toUpperCase() as 'SUCCESS' | 'SKIPPED' | 'FAILED',
    started_at: String(row.started_at || ''),
    finished_at: row.finished_at ? String(row.finished_at) : null,
    buys: Number(summary.buys ?? summary.buyCount ?? 0),
    sells: Number(summary.sells ?? summary.sellCount ?? 0),
    skipped: Number(summary.skipped ?? summary.skippedCount ?? 0),
    errors: Number(summary.errors ?? summary.errorCount ?? 0),
    top_reject_reasons: extractTopRejectReasons(notes),
    key_gate_reasons: extractKeyGateReasons(notes),
    funnel: extractFunnelFromNotes(notes),
    notes,
    diagnosis_line: '',
    diagnosis_breakdown: [],
    compare_rows: [],
  }
}

async function getAutoCycleInsights(
  supabase: SupabaseClient,
  chatId: string | number,
  limit = 8,
): Promise<AutoCycleInsights> {
  const { data, error } = await supabase
    .from('virtual_autotrade_runs')
    .select('id,run_type,run_key,status,summary,started_at,finished_at')
    .eq('chat_id', chatId)
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>
  const baseRuns = rows.map(toAutoCycleInsightRun)
  const [mapped, scanTop] = await Promise.all([
    Promise.all(baseRuns.map((run) => enrichAutoCycleInsightRun(supabase, chatId, run))),
    getScanTopRows(supabase),
  ])

  return {
    latest: mapped[0] || null,
    recent_runs: mapped,
    score_asof: scanTop.scoreAsof,
    scan_top_rows: scanTop.rows,
  }
}

let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) throw new Error('Server not configured')
  _supabase = createClient(url, key, { auth: { persistSession: false } })
  return _supabase
}

function corsHeaders(req: VercelRequest): Record<string, string> {
  const requestOrigin = String(req.headers.origin || '').trim()
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    process.env.UI_CORS_ORIGIN ||
    'https://signal-scanner-web.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

  const allowOrigin = requestOrigin && trustedOrigins.includes(requestOrigin)
    ? requestOrigin
    : (trustedOrigins[0] || '*')

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-ui-key,x-user-chat-id',
    'Access-Control-Allow-Credentials': 'true',
  }
}

// 최근 실행 이력 (virtual_trades, auto 관련 memo 필터링)
async function getRecentActivity(supabase: SupabaseClient, chatId: string | number, limit = 20) {
  const { data, error } = await supabase
    .from('virtual_trades')
    .select('id,code,side,price,quantity,gross_amount,net_amount,fee_amount,tax_amount,pnl_amount,memo,created_at')
    .eq('chat_id', chatId)
    .in('side', ['BUY', 'SELL', 'ADJUST'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  const rows = Array.isArray(data) ? data : []
  if (rows.length === 0) return []

  const codeSet = new Set<string>()
  for (const row of rows) {
    const code = String((row as Record<string, unknown>)?.code || '').trim()
    if (code) codeSet.add(code)
  }

  let nameMap: Record<string, string> = {}
  if (codeSet.size > 0) {
    const { data: stocks } = await supabase
      .from('stocks')
      .select('code,name')
      .in('code', Array.from(codeSet))

    if (Array.isArray(stocks)) {
      nameMap = stocks.reduce((acc, cur) => {
        const code = String((cur as Record<string, unknown>)?.code || '').trim()
        const name = String((cur as Record<string, unknown>)?.name || '').trim()
        if (code && name) acc[code] = name
        return acc
      }, {} as Record<string, string>)
    }
  }

  return rows.map((row) => {
    const record = row as Record<string, unknown>
    const code = String(record.code || '').trim()
    return {
      ...record,
      code,
      stock_name: nameMap[code] || null,
    }
  }) as ActivityRow[]
}

async function getJobSnapshot(
  supabase: SupabaseClient,
  chatId: string | number,
  jobId: string
) {
  const { data, error } = await supabase
    .from('jobs')
    .select('id,type,status,ok,error,created_at,started_at,finished_at,payload')
    .eq('id', jobId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  const job = data as JobRow
  if (job.type !== 'cron_dispatch') return null

  const payload = job.payload || {}
  const payloadChatId = Number((payload as Record<string, unknown>).chat_id || 0)
  if (Number.isFinite(payloadChatId) && payloadChatId > 0 && String(payloadChatId) !== String(chatId)) {
    return null
  }

  const cursor = new Date(Date.parse(String(job.created_at || '')) || Date.now())
  cursor.setMinutes(cursor.getMinutes() - 3)
  const cursorIso = cursor.toISOString()

  const [recentRunsRes, recentTradesRes] = await Promise.all([
    supabase
      .from('virtual_autotrade_runs')
      .select('id,run_type,run_key,status,summary,started_at,finished_at')
      .eq('chat_id', chatId)
      .gte('started_at', cursorIso)
      .order('started_at', { ascending: false })
      .limit(5),
    supabase
      .from('virtual_trades')
      .select('id,code,side,price,quantity,gross_amount,memo,created_at')
      .eq('chat_id', chatId)
      .gte('created_at', cursorIso)
      .order('created_at', { ascending: false })
      .limit(8),
  ])

  const recentRuns = Array.isArray(recentRunsRes.data) ? recentRunsRes.data : []
  const recentTradesRaw = Array.isArray(recentTradesRes.data) ? recentTradesRes.data : []

  const tradeCodeSet = new Set<string>()
  for (const row of recentTradesRaw) {
    const code = String((row as Record<string, unknown>)?.code || '').trim()
    if (code) tradeCodeSet.add(code)
  }

  let tradeNameMap: Record<string, string> = {}
  if (tradeCodeSet.size > 0) {
    const { data: stocks } = await supabase
      .from('stocks')
      .select('code,name')
      .in('code', Array.from(tradeCodeSet))

    if (Array.isArray(stocks)) {
      tradeNameMap = stocks.reduce((acc, cur) => {
        const code = String((cur as Record<string, unknown>)?.code || '').trim()
        const name = String((cur as Record<string, unknown>)?.name || '').trim()
        if (code && name) acc[code] = name
        return acc
      }, {} as Record<string, string>)
    }
  }

  const recentTrades = recentTradesRaw.map((row: unknown) => {
    const record = row as Record<string, unknown>
    const code = String(record.code || '').trim()
    return {
      ...record,
      code,
      stock_name: tradeNameMap[code] || null,
    }
  })

  const latestRun = (recentRuns[0] || null) as Record<string, unknown> | null
  const latestRunSummary = (latestRun?.summary || {}) as Record<string, unknown>

  const dryRunDetails = {
    buys: Number(latestRunSummary.buys ?? latestRunSummary.buyCount ?? 0),
    sells: Number(latestRunSummary.sells ?? latestRunSummary.sellCount ?? 0),
    skipped: Number(latestRunSummary.skipped ?? latestRunSummary.skippedCount ?? 0),
    errors: Number(latestRunSummary.errors ?? latestRunSummary.errorCount ?? 0),
    notes: Array.isArray(latestRunSummary.notes)
      ? latestRunSummary.notes.map((v: unknown) => String(v || '').trim()).filter(Boolean)
      : [],
  }

  const timeline: TimelineEvent[] = []
  if (job.created_at) timeline.push({ ts: job.created_at, kind: 'queued', label: '작업 큐 등록' })
  if (job.started_at) timeline.push({ ts: job.started_at, kind: 'running', label: '워커 실행 시작' })
  if (latestRun?.started_at) timeline.push({ ts: String(latestRun.started_at), kind: 'run_started', label: '자동사이클 계산 시작' })

  for (const trade of recentTrades.slice(0, 5)) {
    const side = String((trade as Record<string, unknown>).side || '').toUpperCase()
    const sideLabel = side === 'BUY' ? '매수' : side === 'SELL' ? '매도' : '조정'
    const name = String((trade as Record<string, unknown>).stock_name || (trade as Record<string, unknown>).code || '-')
    const quantity = Number((trade as Record<string, unknown>).quantity || 0)
    timeline.push({
      ts: String((trade as Record<string, unknown>).created_at || ''),
      kind: 'trade',
      label: `${name} ${sideLabel} ${quantity}주`,
    })
  }

  if (latestRun?.finished_at) {
    const runStatus = String(latestRun.status || '')
    const runStatusLabel = runStatus === 'SUCCESS' ? '실행 요약 완료' : runStatus === 'FAILED' ? '실행 요약 실패' : '실행 요약(스킵)'
    timeline.push({ ts: String(latestRun.finished_at), kind: 'run_finished', label: runStatusLabel })
  }
  if (job.finished_at) {
    const doneLabel = String(job.status || '') === 'failed' ? '작업 종료(실패)' : '작업 종료(완료)'
    timeline.push({ ts: job.finished_at, kind: 'job_finished', label: doneLabel })
  }

  timeline.sort((a, b) => {
    const ta = Date.parse(a.ts || '') || 0
    const tb = Date.parse(b.ts || '') || 0
    return ta - tb
  })

  return {
    job,
    latest_run: latestRun,
    recent_runs: recentRuns,
    recent_trades: recentTrades,
    timeline,
    dry_run_details: dryRunDetails,
  }
}

async function getOperationsDashboardKpi(
  supabase: SupabaseClient,
  chatId: string | number
): Promise<OpsDashboardKpi> {
  const { startIso, endIso, ymd } = kstDayRangeIso()

  const [tradesRes, runsRes, queueRes, holdingsRes] = await Promise.all([
    supabase
      .from('virtual_trades')
      .select('side,gross_amount')
      .eq('chat_id', chatId)
      .gte('created_at', startIso)
      .lt('created_at', endIso),
    supabase
      .from('virtual_autotrade_runs')
      .select('status')
      .eq('chat_id', chatId)
      .gte('started_at', startIso)
      .lt('started_at', endIso),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'cron_dispatch')
      .eq('status', 'queued')
      .contains('payload', { chat_id: Number(chatId) }),
    supabase
      .from('virtual_positions')
      .select('id', { count: 'exact', head: true })
      .eq('chat_id', chatId)
      .eq('status', 'holding')
      .gt('quantity', 0),
  ])

  const latestFailedRes = await supabase
    .from('virtual_autotrade_runs')
    .select('started_at,summary')
    .eq('chat_id', chatId)
    .eq('status', 'FAILED')
    .gte('started_at', startIso)
    .lt('started_at', endIso)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const trades = Array.isArray(tradesRes.data) ? tradesRes.data : []
  const runs = Array.isArray(runsRes.data) ? runsRes.data : []

  let buyCount = 0
  let sellCount = 0
  let adjustCount = 0
  let tradeAmount = 0
  for (const trade of trades) {
    const side = String((trade as Record<string, unknown>)?.side || '').toUpperCase()
    const amount = Number((trade as Record<string, unknown>)?.gross_amount || 0)
    if (side === 'BUY') buyCount += 1
    else if (side === 'SELL') sellCount += 1
    else adjustCount += 1
    if (Number.isFinite(amount)) tradeAmount += amount
  }

  let runSuccess = 0
  let runSkipped = 0
  let runFailed = 0
  for (const run of runs) {
    const status = String((run as Record<string, unknown>)?.status || '').toUpperCase()
    if (status === 'SUCCESS') runSuccess += 1
    else if (status === 'FAILED') runFailed += 1
    else runSkipped += 1
  }

  const latestFailed = (latestFailedRes.data || null) as Record<string, unknown> | null
  const latestSummary = (latestFailed?.summary || {}) as Record<string, unknown>
  const latestNotes = Array.isArray(latestSummary.notes)
    ? latestSummary.notes.map((v) => String(v || '').trim()).filter(Boolean)
    : []
  const noteReason = latestNotes.find((note) => /오류|실패|error|fail|timeout/i.test(note)) || null
  const latestFailedReason = String(latestSummary.error || noteReason || '').trim() || null

  return {
    asof: ymd,
    buy_count: buyCount,
    sell_count: sellCount,
    adjust_count: adjustCount,
    trade_amount: tradeAmount,
    run_total: runs.length,
    run_success: runSuccess,
    run_skipped: runSkipped,
    run_failed: runFailed,
    queue_waiting: queueRes.count || 0,
    holding_count: holdingsRes.count || 0,
    latest_failed_reason: latestFailedReason,
    latest_failed_at: latestFailed?.started_at ? String(latestFailed.started_at) : null,
  }
}

// 자동매도 대상 포지션 점검 (score 없이 단순 조건: 수량 > 0 & holding)
async function getAutoSellCandidates(supabase: SupabaseClient, chatId: string | number) {
  const { data, error } = await supabase
    .from('virtual_positions')
    .select('id,code,quantity,buy_price,status,stock:stocks(code,name,close)')
    .eq('chat_id', chatId)
    .eq('status', 'holding')
    .gt('quantity', 0)

  if (error) throw new Error(error.message)
  const rows = Array.isArray(data) ? data : []

  return rows.map((r: any) => {
    const close = Number(r.stock?.close || 0)
    const buyPrice = Number(r.buy_price || 0)
    const pctChange = buyPrice > 0 ? ((close - buyPrice) / buyPrice) * 100 : 0
    return {
      code: r.code,
      name: r.stock?.name,
      quantity: r.quantity,
      buy_price: buyPrice,
      current_price: close,
      pct_change: Math.round(pctChange * 100) / 100,
    }
  }).sort((a: any, b: any) => a.pct_change - b.pct_change)
}

async function getLotConsistencyReport(
  supabase: SupabaseClient,
  chatId: string | number,
) {
  const [positionsRes, lotsRes] = await Promise.all([
    supabase
      .from('virtual_positions')
      .select('id,code,quantity,buy_price,invested_amount,buy_date,created_at,status,stock:stocks(name)')
      .eq('chat_id', chatId)
      .eq('status', 'holding')
      .gt('quantity', 0),
    supabase
      .from('virtual_trade_lots')
      .select('id,code,remaining_quantity,acquired_quantity,position_id,watchlist_id,seed_position_id')
      .eq('chat_id', chatId)
      .gt('remaining_quantity', 0),
  ])

  if (positionsRes.error) throw new Error(positionsRes.error.message)
  if (lotsRes.error) throw new Error(lotsRes.error.message)

  const positions = Array.isArray(positionsRes.data) ? positionsRes.data : []
  const lots = Array.isArray(lotsRes.data) ? lotsRes.data : []

  const lotQtyByCode = new Map<string, number>()
  for (const lot of lots) {
    const code = String((lot as Record<string, unknown>)?.code || '').trim()
    const remaining = Number((lot as Record<string, unknown>)?.remaining_quantity || 0)
    lotQtyByCode.set(code, (lotQtyByCode.get(code) || 0) + (Number.isFinite(remaining) ? remaining : 0))
  }

  const issues: ConsistencyIssue[] = []
  const positionCodes = new Set<string>()
  for (const position of positions) {
    const record = position as Record<string, unknown>
    const code = String(record.code || '').trim()
    const positionQty = Math.max(0, Math.floor(Number(record.quantity || 0)))
    const lotQty = Math.max(0, Math.floor(Number(lotQtyByCode.get(code) || 0)))
    positionCodes.add(code)
    if (positionQty === lotQty) continue

    const kind = lotQty <= 0 ? 'missing_lots' : 'mismatch'
    issues.push({
      code,
      name: String((record.stock as Record<string, unknown> | null)?.name || '').trim() || null,
      kind,
      position_id: Number(record.id || 0) || null,
      position_qty: positionQty,
      lot_qty: lotQty,
      detail: kind === 'missing_lots'
        ? `보유수량 ${positionQty}주인데 열려 있는 FIFO lot 이 없습니다.`
        : `보유수량 ${positionQty}주와 FIFO lot 합계 ${lotQty}주가 다릅니다.`,
    })
  }

  for (const [code, lotQty] of lotQtyByCode.entries()) {
    if (positionCodes.has(code)) continue
    issues.push({
      code,
      name: null,
      kind: 'orphan_lots',
      position_id: null,
      position_qty: 0,
      lot_qty: Math.max(0, Math.floor(lotQty)),
      detail: `보유 포지션은 없는데 FIFO lot ${Math.max(0, Math.floor(lotQty))}주가 열려 있습니다.`,
    })
  }

  return {
    checked_count: positions.length,
    issue_count: issues.length,
    issues,
  }
}

async function repairLotConsistency(
  supabase: SupabaseClient,
  chatId: string | number,
  codeFilter?: string | null,
) {
  const report = await getLotConsistencyReport(supabase, chatId)
  const positionsRes = await supabase
    .from('virtual_positions')
    .select('id,code,quantity,buy_price,invested_amount,buy_date,created_at,status')
    .eq('chat_id', chatId)
    .eq('status', 'holding')
    .gt('quantity', 0)

  if (positionsRes.error) throw new Error(positionsRes.error.message)
  const positions = Array.isArray(positionsRes.data) ? positionsRes.data : []
  const positionByCode = new Map<string, Record<string, unknown>>()
  for (const position of positions) {
    const code = String((position as Record<string, unknown>)?.code || '').trim()
    if (code) positionByCode.set(code, position as Record<string, unknown>)
  }

  let repairedCount = 0
  const repairedCodes: string[] = []
  const issues = report.issues.filter((issue) => !codeFilter || issue.code === codeFilter)
  const nowIso = new Date().toISOString()

  for (const issue of issues) {
    if (issue.kind === 'orphan_lots') {
      const { error } = await supabase
        .from('virtual_trade_lots')
        .update({ remaining_quantity: 0, closed_at: nowIso, updated_at: nowIso, note: 'ops-consistency-orphan-close' })
        .eq('chat_id', chatId)
        .eq('code', issue.code)
        .gt('remaining_quantity', 0)
      if (error) throw new Error(error.message)
      repairedCount += 1
      repairedCodes.push(issue.code)
      continue
    }

    const position = positionByCode.get(issue.code)
    if (!position) continue
    await replaceTradeLotsForHolding({
      chatId: Number(chatId),
      watchlistId: Number(position.id || 0) || null,
      code: issue.code,
      quantity: Number(position.quantity || 0),
      investedAmount: Number(position.invested_amount || 0),
      buyPrice: Number(position.buy_price || 0),
      acquiredAt: String(position.created_at || ''),
      buyDate: String(position.buy_date || ''),
      note: 'ops-consistency-repair',
    })
    repairedCount += 1
    repairedCodes.push(issue.code)
  }

  const nextReport = await getLotConsistencyReport(supabase, chatId)
  return {
    repaired_count: repairedCount,
    repaired_codes: repairedCodes,
    before: report,
    after: nextReport,
  }
}

// Jobs 큐에 작업 등록
async function enqueueJob(
  supabase: SupabaseClient,
  chatId: string | number,
  taskType: string,
  payload: Record<string, unknown>
): Promise<{ id: string; payload: Record<string, unknown> | null } | null> {
  const dedupKey = `web:${taskType}:${chatId}:${Date.now()}`
  const { data, error } = await supabase.from('jobs').insert({
    type: 'cron_dispatch',
    status: 'queued',
    dedup_key: dedupKey,
    payload: { task: taskType, chat_id: chatId, source: 'web', ...payload },
  }).select('id,payload').single()

  if (error) throw new Error(error.message)
  return data as any
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const integer = Math.floor(parsed)
  return integer > 0 ? integer : fallback
}

async function cleanupLegacyQueuedJobs(
  supabase: SupabaseClient,
  chatId: string | number,
  staleMinutes = 10,
) {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString()
  await supabase
    .from('jobs')
    .update({
      status: 'failed',
      ok: false,
      error: 'superseded by inline web execution',
      finished_at: new Date().toISOString(),
    })
    .eq('type', 'cron_dispatch')
    .eq('status', 'queued')
    .contains('payload', { chat_id: Number(chatId) })
    .lt('created_at', cutoff)
}

async function executeInlineCronDispatch(
  supabase: SupabaseClient,
  job: { id: string; payload: Record<string, unknown> | null },
) {
  const payload = (job.payload || {}) as Record<string, unknown>
  const task = String(payload.task || '').trim()
  const dryRun = payload.dry_run !== false

  await supabase
    .from('jobs')
    .update({ status: 'running', started_at: new Date().toISOString(), error: null })
    .eq('id', job.id)

  try {
    let summary: Record<string, unknown> | null = null

    if (task === 'virtualAutoTrade') {
      const intradayOnly = Boolean(payload.intraday_only)
      const windowMinutes = toPositiveInt(payload.window_minutes, 10)
      const maxUsers = toPositiveInt(payload.max_users, intradayOnly ? 60 : 200)
      const run = await runVirtualAutoTradingCycle({
        mode: 'auto',
        dryRun,
        intradayOnly,
        windowMinutes,
        maxUsers,
      })
      summary = {
        buyCount: run.buyCount,
        sellCount: run.sellCount,
        skippedCount: run.skippedCount,
        errorCount: run.errorCount,
        runType: run.runType,
        runKey: run.runKey,
      }
    } else if (task === 'virtualAutoTradeIntraday') {
      const step = String(payload.step || 'intraday').toLowerCase()
      const intradayOnly = step !== 'ready'
      const run = await runVirtualAutoTradingCycle({
        mode: 'auto',
        dryRun,
        intradayOnly,
        windowMinutes: 10,
        maxUsers: 60,
      })
      summary = {
        buyCount: run.buyCount,
        sellCount: run.sellCount,
        skippedCount: run.skippedCount,
        errorCount: run.errorCount,
        runType: run.runType,
        runKey: run.runKey,
        step,
      }
    } else {
      throw new Error(`unsupported cron_dispatch task: ${task || 'empty'}`)
    }

    await supabase
      .from('jobs')
      .update({
        status: 'done',
        ok: true,
        finished_at: new Date().toISOString(),
        payload: {
          ...payload,
          inline_executed: true,
          inline_summary: summary,
        },
      })
      .eq('id', job.id)

    return { status: 'done' as const }
  } catch (e: any) {
    const message = String(e?.message || e)
    await supabase
      .from('jobs')
      .update({
        status: 'failed',
        ok: false,
        finished_at: new Date().toISOString(),
        error: message,
      })
      .eq('id', job.id)
    return { status: 'failed' as const, error: message }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const headers = corsHeaders(req)
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (denyIfUnauthorizedRead(req, res)) return

  const user = await resolveUiUserContext(req)
  const chatId = user.chatId
  if (!chatId) return res.status(400).json({ error: 'chat_id required' })

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }

  try {
    if (req.method === 'GET') {
      const view = String(req.query.view || 'activity')

      if (view === 'job') {
        const jobId = String(req.query.job_id || '').trim()
        if (!jobId) return res.status(400).json({ error: 'job_id required' })
        const snapshot = await getJobSnapshot(supabase, chatId, jobId)
        if (!snapshot) return res.status(404).json({ error: 'job not found' })
        return res.status(200).json({ ok: true, data: snapshot })
      }

      if (view === 'dashboard') {
        const kpi = await getOperationsDashboardKpi(supabase, chatId)
        return res.status(200).json({ ok: true, data: kpi })
      }

      if (view === 'autocycle_insights') {
        const insights = await getAutoCycleInsights(supabase, chatId)
        return res.status(200).json({ ok: true, data: insights })
      }

      if (view === 'autosellcheck') {
        const candidates = await getAutoSellCandidates(supabase, chatId)
        return res.status(200).json({ ok: true, data: candidates })
      }

      if (view === 'consistency') {
        const report = await getLotConsistencyReport(supabase, chatId)
        return res.status(200).json({ ok: true, data: report })
      }

      // 기본: 최근 실행 이력
      const activity = await getRecentActivity(supabase, chatId)
      return res.status(200).json({ ok: true, data: activity })
    }

    if (req.method === 'POST') {
      const body = (req.body || {}) as any
      const mode = String(body.mode || '').trim().toLowerCase()

      await cleanupLegacyQueuedJobs(supabase, chatId).catch(() => undefined)

      if (mode === 'autocycle') {
        const dryRun = body.dry_run !== false
        const job = await enqueueJob(supabase, chatId, 'virtualAutoTrade', {
          dry_run: dryRun,
          trigger_mode: body.trigger_mode || 'auto',
        })
        if (!job?.id) throw new Error('failed to create job')
        const execution = await executeInlineCronDispatch(supabase, job)
        return res.status(200).json({
          ok: true,
          mode,
          dry_run: dryRun,
          job_id: job.id,
          job_status: execution.status,
          execution_error: execution.status === 'failed' ? execution.error : null,
        })
      }

      if (mode === 'autotrigger') {
        const step = String(body.step || 'intraday').toLowerCase()
        const job = await enqueueJob(supabase, chatId, 'virtualAutoTradeIntraday', {
          step,
          dry_run: body.dry_run !== false,
        })
        if (!job?.id) throw new Error('failed to create job')
        const execution = await executeInlineCronDispatch(supabase, job)
        return res.status(200).json({
          ok: true,
          mode,
          step,
          job_id: job.id,
          job_status: execution.status,
          execution_error: execution.status === 'failed' ? execution.error : null,
        })
      }

      if (mode === 'autosellcheck') {
        const candidates = await getAutoSellCandidates(supabase, chatId)
        return res.status(200).json({ ok: true, mode, data: candidates })
      }

      if (mode === 'consistency_repair') {
        const code = String(body.code || '').trim() || null
        const result = await repairLotConsistency(supabase, chatId, code)
        return res.status(200).json({ ok: true, mode, data: result })
      }

      if (mode === 'reset_autotrade_auto_only') {
        const result = await resetAutoTradeOnlyData(supabase, chatId)
        return res.status(200).json({
          ok: true,
          mode,
          message: '자동매매 이력만 초기화되었습니다. 직접 추가 보유/거래는 유지됩니다.',
          data: result,
        })
      }

      return res.status(400).json({ error: 'unsupported mode' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
