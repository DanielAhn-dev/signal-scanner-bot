import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

type ScoreRow = {
  code: string
  asof: string
  total_score?: number | null
  signal?: string | null
  factors?: Record<string, unknown> | null
}

type PriceRow = {
  code: string
  tradeDate: string
  close: number
}

type EventRow = {
  code: string
  name?: string
  asof: string
  totalScore: number
  signal: string
  rsi14: number | null
  forwardReturnPct: number
}

function parseNum(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(parseNum(value, fallback))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeCode(value: unknown): string {
  const s = String(value || '').trim()
  return s
}

function normalizeDate(value: unknown): string {
  const s = String(value || '').trim()
  if (!s) return ''
  return s.slice(0, 10)
}

function shiftDate(days: number): string {
  const now = new Date()
  const d = new Date(now.getTime() - days * 86_400_000)
  return d.toISOString().slice(0, 10)
}

function splitArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

function asRsi14(factors: Record<string, unknown> | null | undefined): number | null {
  const n = Number(factors?.rsi14)
  if (!Number.isFinite(n)) return null
  return n
}

async function fetchScoreRows(supabase: any, fromDate: string, maxRows: number): Promise<ScoreRow[]> {
  const out: ScoreRow[] = []
  const pageSize = 1000

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await supabase
      .from('scores')
      .select('code,asof,total_score,signal,factors')
      .gte('asof', fromDate)
      .order('asof', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(`scores 조회 실패: ${error.message}`)

    const rows = (data ?? []) as ScoreRow[]
    if (rows.length === 0) break
    out.push(...rows)
    if (rows.length < pageSize) break
  }

  return out.slice(0, maxRows)
}

async function fetchPriceRows(supabase: any, codes: string[], fromDate: string): Promise<PriceRow[]> {
  const out: PriceRow[] = []

  for (const chunk of splitArray(codes, 100)) {
    const { data: dailyData, error: dailyError } = await supabase
      .from('stock_daily')
      .select('ticker,date,close')
      .in('ticker', chunk)
      .gte('date', fromDate)
      .order('date', { ascending: true })

    if (dailyError) throw new Error(`stock_daily 조회 실패: ${dailyError.message}`)

    for (const row of (dailyData ?? []) as Array<Record<string, unknown>>) {
      const code = normalizeCode(row.ticker)
      const tradeDate = normalizeDate(row.date)
      const close = parseNum(row.close, 0)
      if (!code || !tradeDate || close <= 0) continue
      out.push({ code, tradeDate, close })
    }
  }

  for (const chunk of splitArray(codes, 100)) {
    const { data: indicatorData, error: indicatorError } = await supabase
      .from('daily_indicators')
      .select('code,trade_date,close')
      .in('code', chunk)
      .gte('trade_date', fromDate)
      .order('trade_date', { ascending: true })

    if (indicatorError) throw new Error(`daily_indicators 조회 실패: ${indicatorError.message}`)

    for (const row of (indicatorData ?? []) as Array<Record<string, unknown>>) {
      const code = normalizeCode(row.code)
      const tradeDate = normalizeDate(row.trade_date)
      const close = parseNum(row.close, 0)
      if (!code || !tradeDate || close <= 0) continue
      out.push({ code, tradeDate, close })
    }
  }

  return out
}

function buildPriceIndex(rows: PriceRow[]): Map<string, { dates: string[]; closes: number[]; indexByDate: Map<string, number> }> {
  const byCode = new Map<string, Map<string, number>>()

  for (const row of rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, new Map<string, number>())
    byCode.get(row.code)!.set(row.tradeDate, row.close)
  }

  const out = new Map<string, { dates: string[]; closes: number[]; indexByDate: Map<string, number> }>()
  for (const [code, dateMap] of byCode) {
    const dates = Array.from(dateMap.keys()).sort((a, b) => a.localeCompare(b))
    const closes = dates.map((d) => Number(dateMap.get(d) || 0))
    const indexByDate = new Map<string, number>()
    dates.forEach((d, i) => indexByDate.set(d, i))
    out.set(code, { dates, closes, indexByDate })
  }

  return out
}

function parseParams(req: VercelRequest) {
  const horizonBars = parsePositiveInt(req.query.horizon, 20, 5, 180)
  const lookbackDays = parsePositiveInt(req.query.lookbackDays, 180, 60, 720)
  const rallyThresholdPct = parseNum(req.query.rallyPct, 20)
  const topN = parsePositiveInt(req.query.topN, 30, 5, 100)
  const maxRows = parsePositiveInt(req.query.maxRows, 8000, 1000, 30000)
  return { horizonBars, lookbackDays, rallyThresholdPct, topN, maxRows }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const expectedReadKey = process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  const readKey = req.headers['x-ui-key'] || req.query.ui_key
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
      'https://signal-scanner-web.vercel.app,https://stocksweb-seven.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const isTrustedOrigin = !!origin && trustedOrigins.includes(origin)

  if (expectedReadKey && !isTrustedOrigin && String(readKey || '') !== expectedReadKey) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  try {
    const params = parseParams(req)
    const fromDate = shiftDate(params.lookbackDays + params.horizonBars + 10)
    const supabase = createClient(url, key)

    const scoreRowsRaw = await fetchScoreRows(supabase, fromDate, params.maxRows)
    const scoreRows = scoreRowsRaw
      .map((row) => ({
        code: normalizeCode(row.code),
        asof: normalizeDate(row.asof),
        totalScore: parseNum(row.total_score, 0),
        signal: String(row.signal || '').toUpperCase(),
        rsi14: asRsi14(row.factors),
      }))
      .filter((row) => row.code && row.asof)

    const codes = Array.from(new Set(scoreRows.map((row) => row.code)))
    if (!codes.length) {
      return res.status(200).json({ ok: true, data: { params, baseline: { labelableEvents: 0 }, risers: [], commonFeatures: {} } })
    }

    const priceRows = await fetchPriceRows(supabase, codes, fromDate)
    const priceIndex = buildPriceIndex(priceRows)

    const labelableEvents: EventRow[] = []
    for (const row of scoreRows) {
      const idx = priceIndex.get(row.code)
      if (!idx) continue
      const anchorIndex = idx.indexByDate.get(row.asof)
      if (anchorIndex == null) continue
      const targetIndex = anchorIndex + params.horizonBars
      if (targetIndex >= idx.closes.length) continue

      const entry = idx.closes[anchorIndex]
      const exit = idx.closes[targetIndex]
      if (!(entry > 0 && exit > 0)) continue

      const forwardReturnPct = Number((((exit - entry) / entry) * 100).toFixed(2))
      labelableEvents.push({
        code: row.code,
        asof: row.asof,
        totalScore: Number(row.totalScore.toFixed(2)),
        signal: row.signal,
        rsi14: row.rsi14,
        forwardReturnPct,
      })
    }

    const risers = labelableEvents
      .filter((row) => row.forwardReturnPct >= params.rallyThresholdPct)
      .sort((a, b) => b.forwardReturnPct - a.forwardReturnPct)
      .slice(0, params.topN)

    // 종목명 일괄 조회
    const riserCodes = Array.from(new Set(risers.map((r) => r.code)))
    const nameMap = new Map<string, string>()
    for (const chunk of splitArray(riserCodes, 100)) {
      const { data: stockRows } = await supabase
        .from('stocks')
        .select('code,name')
        .in('code', chunk)
      for (const row of (stockRows ?? []) as Array<{ code: string; name: string }>) {
        if (row.code && row.name) nameMap.set(row.code, row.name)
      }
    }
    const risersWithNames = risers.map((r) => ({
      ...r,
      name: nameMap.get(r.code) ?? undefined,
    }))

    const baselineCount = labelableEvents.length
    const riserCount = risers.length

    const baselineScore70 = baselineCount > 0
      ? (labelableEvents.filter((row) => row.totalScore >= 70).length / baselineCount) * 100
      : 0
    const riserScore70 = riserCount > 0
      ? (risers.filter((row) => row.totalScore >= 70).length / riserCount) * 100
      : 0

    const baselineBuySignal = baselineCount > 0
      ? (labelableEvents.filter((row) => row.signal === 'BUY' || row.signal === 'STRONG_BUY').length / baselineCount) * 100
      : 0
    const riserBuySignal = riserCount > 0
      ? (risers.filter((row) => row.signal === 'BUY' || row.signal === 'STRONG_BUY').length / riserCount) * 100
      : 0

    const rsiBand45to65 = riserCount > 0
      ? (risers.filter((row) => row.rsi14 != null && row.rsi14 >= 45 && row.rsi14 <= 65).length / riserCount) * 100
      : 0

    const avgForwardReturn = riserCount > 0
      ? risers.reduce((acc, row) => acc + row.forwardReturnPct, 0) / riserCount
      : 0

    return res.status(200).json({
      ok: true,
      data: {
        params,
        baseline: {
          labelableEvents: baselineCount,
          score70RatePct: Number(baselineScore70.toFixed(1)),
          buySignalRatePct: Number(baselineBuySignal.toFixed(1)),
        },
        riserSummary: {
          riserEvents: riserCount,
          avgForwardReturnPct: Number(avgForwardReturn.toFixed(2)),
        },
        commonFeatures: {
          score70RatePct: Number(riserScore70.toFixed(1)),
          score70LiftPct: Number((riserScore70 - baselineScore70).toFixed(1)),
          buySignalRatePct: Number(riserBuySignal.toFixed(1)),
          buySignalLiftPct: Number((riserBuySignal - baselineBuySignal).toFixed(1)),
          rsi45to65RatePct: Number(rsiBand45to65.toFixed(1)),
        },
        risers: risersWithNames,
      },
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
