import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'

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

  const latestRun = recentRuns[0] || null

  return {
    job,
    latest_run: latestRun,
    recent_runs: recentRuns,
    recent_trades: recentTrades,
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
): Promise<{ id: string } | null> {
  const dedupKey = `web:${taskType}:${chatId}:${Date.now()}`
  const { data, error } = await supabase.from('jobs').insert({
    type: 'cron_dispatch',
    status: 'queued',
    dedup_key: dedupKey,
    payload: { task: taskType, chat_id: chatId, source: 'web', ...payload },
  }).select('id').single()

  if (error) throw new Error(error.message)
  return data as any
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

      if (mode === 'autocycle') {
        const dryRun = body.dry_run !== false
        const job = await enqueueJob(supabase, chatId, 'virtualAutoTrade', {
          dry_run: dryRun,
          trigger_mode: body.trigger_mode || 'auto',
        })
        return res.status(200).json({ ok: true, mode, dry_run: dryRun, job_id: (job as any)?.id })
      }

      if (mode === 'autotrigger') {
        const step = String(body.step || 'intraday').toLowerCase()
        const job = await enqueueJob(supabase, chatId, 'virtualAutoTradeIntraday', {
          step,
          dry_run: body.dry_run !== false,
        })
        return res.status(200).json({ ok: true, mode, step, job_id: (job as any)?.id })
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
