import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'
import { runVirtualAutoTradingCycle } from '../../src/services/virtualAutoTradeService'

type ActivityRow = {
  id: string
  code: string
  side: 'BUY' | 'SELL' | 'ADJUST'
  price: number
  quantity: number
  gross_amount: number
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
    .select('id,code,side,price,quantity,gross_amount,memo,created_at')
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

  const recentTrades = recentTradesRaw.map((row) => {
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
      ? latestRunSummary.notes.map((v) => String(v || '').trim()).filter(Boolean)
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

  const expectedReadKey = process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  const readKey = req.headers['x-ui-key'] || req.query.ui_key
  const requestOrigin = String(req.headers.origin || '').trim()
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    process.env.UI_CORS_ORIGIN ||
    'https://signal-scanner-web.vercel.app,http://localhost:5173',
  ).split(',').map((v) => v.trim()).filter(Boolean)
  const isTrustedOrigin = !!requestOrigin && trustedOrigins.includes(requestOrigin)

  if (expectedReadKey && !isTrustedOrigin && String(readKey || '') !== expectedReadKey) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const user = resolveUiUserContext(req)
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

      if (view === 'autosellcheck') {
        const candidates = await getAutoSellCandidates(supabase, chatId)
        return res.status(200).json({ ok: true, data: candidates })
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

      return res.status(400).json({ error: 'unsupported mode' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
