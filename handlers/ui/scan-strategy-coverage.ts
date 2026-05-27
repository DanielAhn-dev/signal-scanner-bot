import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'
const CACHE_TTL_MS = 120_000

type StrategyKey = 'day' | 'overnight' | 'weekly'

type SignalRow = {
  code: string
  trade_date: string
  is_quick_strict: boolean
  is_quick_lite: boolean
}

type PriceRow = {
  ticker: string
  date: string
  open: number | null
  close: number | null
}

type PriceIndex = {
  dates: string[]
  opens: number[]
  closes: number[]
  indexByDate: Map<string, number>
}

type StrategyCoverage = {
  key: StrategyKey
  label: string
  signalCount: number
  returnCount: number
  coveragePct: number
  minRequired: number
  hasEnoughSamples: boolean
}

type CacheEntry = {
  expiresAt: number
  payload: any
}

const cache = new Map<string, CacheEntry>()

let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) throw new Error('Server not configured')
  _supabase = createClient(url, key, { auth: { persistSession: false } })
  return _supabase
}

function normalizeCode(value: unknown): string {
  return String(value || '').trim()
}

function normalizeDate(value: unknown): string {
  return String(value || '').trim().slice(0, 10)
}

function parseNum(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function shiftDate(days: number): string {
  const now = new Date()
  const d = new Date(now.getTime() - days * 86_400_000)
  return d.toISOString().slice(0, 10)
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function fetchSignalRowsPaged(supabase: SupabaseClient, fromDate: string): Promise<SignalRow[]> {
  const out: SignalRow[] = []
  const pageSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('scan_signal_history')
      .select('code,trade_date,is_quick_strict,is_quick_lite')
      .gte('trade_date', fromDate)
      .order('trade_date', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    const rows = (data ?? []) as SignalRow[]
    out.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }

  return out
}

async function fetchPriceRowsPaged(supabase: SupabaseClient, codeChunk: string[], fromDate: string): Promise<PriceRow[]> {
  const out: PriceRow[] = []
  const pageSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('stock_daily')
      .select('ticker,date,open,close')
      .in('ticker', codeChunk)
      .gte('date', fromDate)
      .order('date', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    const rows = (data ?? []) as PriceRow[]
    out.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }

  return out
}

function buildPriceIndex(rows: PriceRow[]): Map<string, PriceIndex> {
  const byCode = new Map<string, Map<string, { open: number; close: number }>>()
  for (const row of rows) {
    const code = normalizeCode(row.ticker)
    const date = normalizeDate(row.date)
    const open = parseNum(row.open, 0)
    const close = parseNum(row.close, 0)
    if (!code || !date || !(open > 0) || !(close > 0)) continue
    if (!byCode.has(code)) byCode.set(code, new Map())
    byCode.get(code)!.set(date, { open, close })
  }

  const out = new Map<string, PriceIndex>()
  for (const [code, daily] of byCode) {
    const dates = Array.from(daily.keys()).sort((a, b) => a.localeCompare(b))
    const opens = dates.map((date) => Number(daily.get(date)?.open || 0))
    const closes = dates.map((date) => Number(daily.get(date)?.close || 0))
    const indexByDate = new Map<string, number>()
    dates.forEach((date, idx) => indexByDate.set(date, idx))
    out.set(code, { dates, opens, closes, indexByDate })
  }
  return out
}

function summarizeCoverage(
  key: StrategyKey,
  label: string,
  signalCount: number,
  returnCount: number,
): StrategyCoverage {
  const minRequired = key === 'day' ? 12 : 8
  const coveragePct = signalCount > 0 ? round2((returnCount / signalCount) * 100) : 0
  return {
    key,
    label,
    signalCount,
    returnCount,
    coveragePct,
    minRequired,
    hasEnoughSamples: returnCount >= minRequired,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN || '*'
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
    'https://signal-scanner-web.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const isTrustedOrigin = !!origin && trustedOrigins.includes(origin)
  if (expectedReadKey && !isTrustedOrigin && String(readKey || '') !== expectedReadKey) {
    return res.status(401).json({ error: 'Unauthorized', detail: 'Invalid UI read key' })
  }

  const lookbackDays = Math.min(365, Math.max(20, Math.floor(Number(req.query.lookbackDays || 120))))
  const cacheKey = JSON.stringify({ lookbackDays })
  const cached = cache.get(cacheKey)
  if (cached && Date.now() <= cached.expiresAt) {
    return res.status(200).json(cached.payload)
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const fromDate = shiftDate(lookbackDays + 10)

    const signals = await fetchSignalRowsPaged(supabase, fromDate)
    const signalRows = (signals as SignalRow[]).filter((row) => !!row.code && !!row.trade_date)
    const signalCodes = Array.from(new Set(signalRows.map((row) => normalizeCode(row.code)).filter(Boolean)))
    const signalDates = new Set(signalRows.map((row) => normalizeDate(row.trade_date)).filter(Boolean))

    const priceRows: PriceRow[] = []
    if (signalCodes.length > 0) {
      const codeChunks = chunk(signalCodes, 200)
      for (const codeChunk of codeChunks) {
        const prices = await fetchPriceRowsPaged(supabase, codeChunk, fromDate)
        priceRows.push(...prices)
      }
    }

    const priceIndex = buildPriceIndex(priceRows)
    const priceDates = new Set(priceRows.map((row) => normalizeDate(row.date)).filter(Boolean))

    let daySignals = 0
    let dayReturns = 0
    let overnightSignals = 0
    let overnightReturns = 0
    let weeklySignals = 0
    let weeklyReturns = 0

    for (const row of signalRows) {
      const code = normalizeCode(row.code)
      const tradeDate = normalizeDate(row.trade_date)
      const idx = priceIndex.get(code)
      if (!idx) continue
      const anchor = idx.indexByDate.get(tradeDate)
      if (anchor == null) continue

      if (row.is_quick_strict) {
        daySignals += 1
        const entry = idx.opens[anchor]
        const exit = idx.closes[anchor]
        if (entry > 0 && exit > 0) dayReturns += 1
      }

      if (row.is_quick_lite) {
        overnightSignals += 1
        if (anchor + 1 < idx.closes.length && anchor + 1 < idx.opens.length) {
          const entryClose = idx.closes[anchor]
          const nextOpen = idx.opens[anchor + 1]
          if (entryClose > 0 && nextOpen > 0) overnightReturns += 1
        }

        weeklySignals += 1
        if (anchor + 5 < idx.closes.length) {
          const entryClose = idx.closes[anchor]
          const weekClose = idx.closes[anchor + 5]
          if (entryClose > 0 && weekClose > 0) weeklyReturns += 1
        }
      }
    }

    const strategies = {
      day: summarizeCoverage('day', '데이(당일 시가→종가)', daySignals, dayReturns),
      overnight: summarizeCoverage('overnight', '오버나이트(당일 종가→익일 시가)', overnightSignals, overnightReturns),
      weekly: summarizeCoverage('weekly', '주간(당일 종가→5거래일 종가)', weeklySignals, weeklyReturns),
    }

    const alerts: string[] = []
    if (signalRows.length === 0) {
      alerts.push('scan_signal_history 이력이 비어 있습니다. 백필이 필요합니다.')
    }
    if (signalRows.length > 0 && priceRows.length === 0) {
      alerts.push('stock_daily 가격 데이터가 부족하여 전략 수익률 계산이 불가능합니다.')
    }
    for (const metric of Object.values(strategies)) {
      if (!metric.hasEnoughSamples) {
        alerts.push(`${metric.label} 표본 부족: ${metric.returnCount}/${metric.minRequired} (커버리지 ${metric.coveragePct}%)`)
      }
    }

    const payload = {
      lookbackDays,
      generatedAt: new Date().toISOString(),
      history: {
        signalCount: signalRows.length,
        signalDateCount: signalDates.size,
        signalCodeCount: signalCodes.length,
      },
      price: {
        priceRowCount: priceRows.length,
        priceDateCount: priceDates.size,
        priceCodeCount: priceIndex.size,
      },
      strategies,
      alerts,
      needsBackfill: alerts.length > 0,
    }

    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload })
    return res.status(200).json(payload)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
