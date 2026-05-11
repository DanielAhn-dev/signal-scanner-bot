import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { applyAdaptiveOverlayToPullbackCandidate, getAdaptiveStrategyInsights } from '../../src/services/adaptiveStrategyService'
import { fetchRealtimePriceBatch } from '../../src/utils/fetchRealtimePrice'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'
const SCAN_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_SCAN_CANDIDATES_CACHE_TTL_MS || 15_000))

type ScanCacheEntry = {
  expiresAt: number
  payload: any
}

const scanCache = new Map<string, ScanCacheEntry>()

function isKrxIntradaySession(base = new Date()): boolean {
  const kst = new Date(base.getTime() + 9 * 60 * 60 * 1000)
  const day = kst.getUTCDay()
  if (day === 0 || day === 6) return false
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes()
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=45')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

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

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const adaptiveInsights = await getAdaptiveStrategyInsights(supabase)
    const intraday = isKrxIntradaySession()

    const limit = Math.min(200, Math.max(20, Number(req.query.limit || 60)))
    const includeIndicatorLiquidity = String(req.query.includeIndicatorLiquidity || '0') === '1'
    const bypassCache = String(req.query.cacheMs || '') === '0' || intraday
    const cacheKey = JSON.stringify({ limit, includeIndicatorLiquidity })

    if (!bypassCache && SCAN_CACHE_TTL_MS > 0) {
      const cached = scanCache.get(cacheKey)
      if (cached && Date.now() <= cached.expiresAt) {
        return res.status(200).json(cached.payload)
      }
      if (cached) scanCache.delete(cacheKey)
    }

    const { data: latestRows, error: latestError } = await supabase
      .from('pullback_signals')
      .select('trade_date')
      .order('trade_date', { ascending: false })
      .limit(1)

    if (latestError) return res.status(500).json({ error: latestError.message })

    const latestDate = latestRows?.[0]?.trade_date
    if (!latestDate) {
      return res.status(200).json({
        latestDate: null,
        count: 0,
        data: [],
      })
    }

    const { data, error } = await supabase
      .from('pullback_signals')
      .select(`
        trade_date,
        code,
        entry_grade,
        entry_score,
        trend_grade,
        dist_grade,
        dist_pct,
        pivot_grade,
        vol_atr_grade,
        warn_grade,
        warn_score,
        stock:stocks!inner(code,name,sector_id,liquidity,updated_at,close)
      `)
      .eq('trade_date', latestDate)
      .neq('warn_grade', 'SELL')
      .in('entry_grade', ['A', 'B'])
      .order('entry_score', { ascending: false })
      .limit(limit)

    if (error) return res.status(500).json({ error: error.message })

    const indicatorLiquidityByCode = new Map<string, number>()
    if (includeIndicatorLiquidity) {
      const codes = (data ?? []).map((row: any) => String(row?.code || '')).filter(Boolean)
      if (codes.length === 0) {
        const payload = {
          latestDate,
          count: 0,
          data: [],
        }
        if (!bypassCache && SCAN_CACHE_TTL_MS > 0) {
          scanCache.set(cacheKey, {
            expiresAt: Date.now() + SCAN_CACHE_TTL_MS,
            payload,
          })
        }
        return res.status(200).json(payload)
      }

      // 환경별 스키마 차이를 허용: daily_indicators(신규) 우선, indicators(레거시) 폴백
      const indicatorQuery = await supabase
        .from('daily_indicators')
        .select('code,value_traded')
        .eq('trade_date', latestDate)
        .in('code', codes)

      const indicatorRows = indicatorQuery.error
        ? (await supabase
          .from('indicators')
          .select('code,value_traded')
          .eq('trade_date', latestDate)
          .in('code', codes)).data
        : indicatorQuery.data

      for (const item of indicatorRows ?? []) {
        const code = String((item as any)?.code || '').trim()
        const valueTraded = Number((item as any)?.value_traded)
        if (!code || !Number.isFinite(valueTraded) || valueTraded <= 0) continue
        indicatorLiquidityByCode.set(code, valueTraded)
      }
    }

    const codes = (data ?? []).map((row: any) => String(row?.code || '')).filter(Boolean)
    const realtimeMap = intraday && codes.length > 0
      ? await fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, any>))
      : ({} as Record<string, any>)

    let realtimeAppliedCount = 0

    const rows = (data ?? []).map((row: any) => {
      const stock = Array.isArray(row.stock) ? (row.stock[0] || {}) : (row.stock || {})
      const adaptive = applyAdaptiveOverlayToPullbackCandidate(row, adaptiveInsights)
      const baseScore = Number(row.entry_score ?? 0) * 20 - Number(row.warn_score ?? 0) * 3
      const closePrice = Number(stock.close ?? 0)
      const realtimePrice = Number(realtimeMap[row.code]?.price ?? 0)
      const hasRealtime = intraday && Number.isFinite(realtimePrice) && realtimePrice > 0
      const currentPrice = hasRealtime ? realtimePrice : (Number.isFinite(closePrice) && closePrice > 0 ? closePrice : null)
      const intradayChangePct = hasRealtime && closePrice > 0
        ? ((realtimePrice - closePrice) / closePrice) * 100
        : 0
      if (hasRealtime) realtimeAppliedCount += 1

      // 장중에는 현재가 변화폭을 점수에 반영해 순위 변화 체감을 높임
      const intradayDelta = hasRealtime
        ? clamp(intradayChangePct * 2.4, -15, 15)
        : 0

      return {
        code: row.code,
        trade_date: row.trade_date,
        entry_grade: row.entry_grade,
        entry_score: row.entry_score,
        trend_grade: row.trend_grade,
        dist_grade: row.dist_grade,
        dist_pct: row.dist_pct,
        pivot_grade: row.pivot_grade,
        vol_atr_grade: row.vol_atr_grade,
        warn_grade: row.warn_grade,
        warn_score: row.warn_score,
        name: stock.name || row.code,
        sector_id: stock.sector_id || null,
        liquidity: stock.liquidity ?? indicatorLiquidityByCode.get(String(row.code)) ?? null,
        close: stock.close ?? null,
        current_price: currentPrice,
        price_source: hasRealtime ? 'realtime' : 'close',
        intraday_change_pct: hasRealtime ? round2(intradayChangePct) : 0,
        stock_updated_at: stock.updated_at ?? null,
        adaptive_adjustment: adaptive.adjustment,
        adaptive_reasons: adaptive.reasons,
        adaptive_score: round1(baseScore + adaptive.adjustment + intradayDelta),
      }
    })

    rows.sort((a: any, b: any) => Number(b.adaptive_score ?? 0) - Number(a.adaptive_score ?? 0) || Number(b.entry_score ?? 0) - Number(a.entry_score ?? 0))

    const payload = {
      marketPhase: intraday ? 'intraday' : 'after-close',
      realtimeAppliedCount,
      latestDate,
      count: rows.length,
      data: rows,
    }

    if (!bypassCache && SCAN_CACHE_TTL_MS > 0) {
      scanCache.set(cacheKey, {
        expiresAt: Date.now() + SCAN_CACHE_TTL_MS,
        payload,
      })
    }

    return res.status(200).json(payload)
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
