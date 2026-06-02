import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { chunkValues, getPagingRunStatsSummary, resetPagingRunStats, selectPaged } from '../../src/services/supabasePaging'
import { denyIfUnauthorizedRead } from './_accessControl'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'
const CACHE_TTL_MS = 120_000

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

type StrategyMetric = {
  key: 'day' | 'overnight' | 'weekly'
  label: string
  trades: number
  winRatePct: number
  avgReturnPct: number
  bestReturnPct: number
  worstReturnPct: number
  sumReturnPct: number
  recentReturns20: number[]
}

type PriceIndex = {
  dates: string[]
  opens: number[]
  closes: number[]
  indexByDate: Map<string, number>
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

async function fetchSignalRowsPaged(supabase: SupabaseClient, fromDate: string): Promise<SignalRow[]> {
  return await selectPaged<SignalRow>(
    async (from, to) =>
      await supabase
        .from('scan_signal_history')
        .select('code,trade_date,is_quick_strict,is_quick_lite')
        .gte('trade_date', fromDate)
        .order('trade_date', { ascending: true })
        .range(from, to),
    {
      pageSize: 1000,
      maxRows: 120000,
      logLabel: 'handler.scan_strategy_metrics.signals',
    }
  ).catch((error) => {
    throw new Error(String((error as Error)?.message || error))
  })
}

async function fetchPriceRowsPaged(supabase: SupabaseClient, codeChunk: string[], fromDate: string): Promise<PriceRow[]> {
  const maxRows = Math.max(10000, Math.min(120000, codeChunk.length * 450))
  return await selectPaged<PriceRow>(
    async (from, to) =>
      await supabase
        .from('stock_daily')
        .select('ticker,date,open,close')
        .in('ticker', codeChunk)
        .gte('date', fromDate)
        .order('date', { ascending: true })
        .range(from, to),
    {
      pageSize: 1000,
      maxRows,
      logLabel: 'handler.scan_strategy_metrics.prices',
    }
  ).catch((error) => {
    throw new Error(String((error as Error)?.message || error))
  })
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

function summarizeReturns(key: StrategyMetric['key'], label: string, returns: number[]): StrategyMetric {
  const recentReturns20 = returns.slice(-20).map((value) => round2(value))
  const trades = returns.length
  if (trades === 0) {
    return {
      key,
      label,
      trades: 0,
      winRatePct: 0,
      avgReturnPct: 0,
      bestReturnPct: 0,
      worstReturnPct: 0,
      sumReturnPct: 0,
      recentReturns20,
    }
  }

  const wins = returns.filter((value) => value > 0).length
  const sum = returns.reduce((acc, value) => acc + value, 0)

  return {
    key,
    label,
    trades,
    winRatePct: round2((wins / trades) * 100),
    avgReturnPct: round2(sum / trades),
    bestReturnPct: round2(Math.max(...returns)),
    worstReturnPct: round2(Math.min(...returns)),
    sumReturnPct: round2(sum),
    recentReturns20,
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

  if (denyIfUnauthorizedRead(req, res)) return

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
    resetPagingRunStats()

    const fromDate = shiftDate(lookbackDays + 10)

    const signals = await fetchSignalRowsPaged(supabase, fromDate)
    const signalRows = (signals as SignalRow[]).filter((row) => !!row.code && !!row.trade_date)
    if (signalRows.length === 0) {
      const payload = {
        lookbackDays,
        summary: {
          totalSignals: 0,
          metrics: [
            summarizeReturns('day', '데이(당일 시가→종가)', []),
            summarizeReturns('overnight', '오버나이트(당일 종가→익일 시가)', []),
            summarizeReturns('weekly', '주간(당일 종가→5거래일 종가)', []),
          ],
        },
        meta: {
          paging: getPagingRunStatsSummary(),
        },
      }
      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload })
      return res.status(200).json(payload)
    }

    const codes = Array.from(new Set(signalRows.map((row) => normalizeCode(row.code)).filter(Boolean)))
    const codeChunks = chunkValues(codes)
    const priceRows: PriceRow[] = []

    for (const codeChunk of codeChunks) {
      const prices = await fetchPriceRowsPaged(supabase, codeChunk, fromDate)
      priceRows.push(...prices)
    }

    const priceIndex = buildPriceIndex(priceRows)

    const dayReturns: number[] = []
    const overnightReturns: number[] = []
    const weeklyReturns: number[] = []

    for (const row of signalRows) {
      const code = normalizeCode(row.code)
      const tradeDate = normalizeDate(row.trade_date)
      const idx = priceIndex.get(code)
      if (!idx) continue
      const anchor = idx.indexByDate.get(tradeDate)
      if (anchor == null) continue

      if (row.is_quick_strict) {
        const entry = idx.opens[anchor]
        const exit = idx.closes[anchor]
        if (entry > 0 && exit > 0) {
          dayReturns.push(((exit - entry) / entry) * 100)
        }
      }

      if (row.is_quick_lite) {
        if (anchor + 1 < idx.closes.length && anchor + 1 < idx.opens.length) {
          const entryClose = idx.closes[anchor]
          const nextOpen = idx.opens[anchor + 1]
          if (entryClose > 0 && nextOpen > 0) {
            overnightReturns.push(((nextOpen - entryClose) / entryClose) * 100)
          }
        }

        if (anchor + 5 < idx.closes.length) {
          const entryClose = idx.closes[anchor]
          const weekClose = idx.closes[anchor + 5]
          if (entryClose > 0 && weekClose > 0) {
            weeklyReturns.push(((weekClose - entryClose) / entryClose) * 100)
          }
        }
      }
    }

    const payload = {
      lookbackDays,
      summary: {
        totalSignals: signalRows.length,
        metrics: [
          summarizeReturns('day', '데이(당일 시가→종가)', dayReturns),
          summarizeReturns('overnight', '오버나이트(당일 종가→익일 시가)', overnightReturns),
          summarizeReturns('weekly', '주간(당일 종가→5거래일 종가)', weeklyReturns),
        ],
      },
      meta: {
        paging: getPagingRunStatsSummary(),
      },
    }

    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload })
    return res.status(200).json(payload)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
