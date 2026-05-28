import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { chunkValues, getPagingRunStatsSummary, resetPagingRunStats, selectPaged } from '../../src/services/supabasePaging'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'
const CACHE_TTL_MS = 90_000

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

type DrilldownItem = {
  tradeDate: string
  code: string
  name: string
  strategyKey: StrategyKey
  strategyLabel: string
  returnPct: number | null
  outcomeStatus: 'realized' | 'pending'
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
      logLabel: 'handler.scan_strategy_drilldown.signals',
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
      logLabel: 'handler.scan_strategy_drilldown.prices',
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

function parseStrategyKey(raw: unknown): StrategyKey | 'all' {
  const text = String(raw || '').trim().toLowerCase()
  if (text === 'day' || text === 'overnight' || text === 'weekly') return text
  return 'all'
}

function strategyLabel(key: StrategyKey): string {
  if (key === 'day') return '데이'
  if (key === 'overnight') return '오버나이트'
  return '주간'
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
  const limit = Math.min(120, Math.max(10, Math.floor(Number(req.query.limit || 40))))
  const strategy = parseStrategyKey(req.query.strategy)

  const cacheKey = JSON.stringify({ lookbackDays, limit, strategy })
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
    const signalRows = (signals ?? []).filter((row) => !!row.code && !!row.trade_date)
    if (signalRows.length === 0) {
      const payload = {
        lookbackDays,
        strategy,
        count: 0,
        items: [] as DrilldownItem[],
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
    const items: DrilldownItem[] = []

    const includeDay = strategy === 'all' || strategy === 'day'
    const includeOvernight = strategy === 'all' || strategy === 'overnight'
    const includeWeekly = strategy === 'all' || strategy === 'weekly'

    for (const row of signalRows) {
      const code = normalizeCode(row.code)
      const tradeDate = normalizeDate(row.trade_date)
      const idx = priceIndex.get(code)
      if (!idx) continue
      const anchor = idx.indexByDate.get(tradeDate)
      if (anchor == null) continue

      if (includeDay && row.is_quick_strict) {
        const entry = idx.opens[anchor]
        const exit = idx.closes[anchor]
        if (entry > 0 && exit > 0) {
          items.push({
            tradeDate,
            code,
            name: code,
            strategyKey: 'day',
            strategyLabel: strategyLabel('day'),
            returnPct: round2(((exit - entry) / entry) * 100),
            outcomeStatus: 'realized',
          })
        }
      }

      if (row.is_quick_lite && includeOvernight && anchor + 1 < idx.opens.length && anchor < idx.closes.length) {
        const entryClose = idx.closes[anchor]
        const nextOpen = idx.opens[anchor + 1]
        if (entryClose > 0 && nextOpen > 0) {
          items.push({
            tradeDate,
            code,
            name: code,
            strategyKey: 'overnight',
            strategyLabel: strategyLabel('overnight'),
            returnPct: round2(((nextOpen - entryClose) / entryClose) * 100),
            outcomeStatus: 'realized',
          })
        }
      }

      if (row.is_quick_lite && includeWeekly && anchor + 5 < idx.closes.length) {
        const entryClose = idx.closes[anchor]
        const weekClose = idx.closes[anchor + 5]
        if (entryClose > 0 && weekClose > 0) {
          items.push({
            tradeDate,
            code,
            name: code,
            strategyKey: 'weekly',
            strategyLabel: strategyLabel('weekly'),
            returnPct: round2(((weekClose - entryClose) / entryClose) * 100),
            outcomeStatus: 'realized',
          })
        }
      } else if (row.is_quick_lite && includeWeekly) {
        const entryClose = idx.closes[anchor]
        if (entryClose > 0) {
          items.push({
            tradeDate,
            code,
            name: code,
            strategyKey: 'weekly',
            strategyLabel: `${strategyLabel('weekly')} · 대기`,
            returnPct: null,
            outcomeStatus: 'pending',
          })
        }
      }
    }

    items.sort((a, b) => {
      const dateCompare = b.tradeDate.localeCompare(a.tradeDate)
      if (dateCompare !== 0) return dateCompare
      if (a.outcomeStatus !== b.outcomeStatus) {
        return a.outcomeStatus === 'realized' ? -1 : 1
      }
      return Math.abs(Number(b.returnPct ?? 0)) - Math.abs(Number(a.returnPct ?? 0))
    })

    const limitedItems = items.slice(0, limit)
    const nameCodes = Array.from(new Set(limitedItems.map((item) => item.code)))
    const names = new Map<string, string>()

    if (nameCodes.length > 0) {
      for (const codeChunk of chunkValues(nameCodes)) {
        const { data: stocks } = await supabase
          .from('stocks')
          .select('code,name')
          .in('code', codeChunk)
        for (const row of stocks ?? []) {
          const code = normalizeCode((row as any)?.code)
          const name = String((row as any)?.name || code)
          if (code) names.set(code, name)
        }
      }
    }

    for (const item of limitedItems) {
      item.name = names.get(item.code) || item.name
    }

    const payload = {
      lookbackDays,
      strategy,
      count: limitedItems.length,
      items: limitedItems,
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
