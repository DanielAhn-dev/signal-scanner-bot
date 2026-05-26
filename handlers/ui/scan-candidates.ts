import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { applyAdaptiveOverlayToPullbackCandidate, getAdaptiveStrategyInsights } from '../../src/services/adaptiveStrategyService'
import { scoreLeadAccumulationCandidate } from '../../src/services/accumulationSignalService'
import { fetchRealtimePriceBatch } from '../../src/utils/fetchRealtimePrice'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'
const SCAN_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_SCAN_CANDIDATES_CACHE_TTL_MS || 15_000))

type ScanCacheEntry = {
  expiresAt: number
  payload: any
}

type SignalHistoryRow = {
  code: string
  trade_date: string
  is_quick_strict: boolean
  is_quick_lite: boolean
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

function normalizeScanScoreToPct(raw: number | null | undefined): number {
  const safe = Number(raw ?? 0)
  if (!Number.isFinite(safe)) return 0
  if (safe > 5) return clamp(safe, 0, 100)
  return clamp(safe * 20, 0, 100)
}

function computeQuickTradeScore(item: {
  entry_score?: number | null
  warn_score?: number | null
  liquidity?: number | null
  intraday_change_pct?: number | null
}): number {
  const entryPct = normalizeScanScoreToPct(item.entry_score)
  const warnPct = normalizeScanScoreToPct(item.warn_score)
  const safetyPct = 100 - warnPct
  const liquidity = Number(item.liquidity ?? 0)
  const liquidityScore =
    liquidity >= 80_000_000_000 ? 100 :
    liquidity >= 30_000_000_000 ? 85 :
    liquidity >= 10_000_000_000 ? 70 :
    liquidity >= 3_000_000_000 ? 55 :
    liquidity >= 1_000_000_000 ? 40 : 20
  const intraday = Number(item.intraday_change_pct ?? 0)
  const intradayFit = clamp(100 - Math.abs(intraday - 1.8) * 18, 0, 100)
  return clamp(
    entryPct * 0.46 +
    safetyPct * 0.16 +
    liquidityScore * 0.24 +
    intradayFit * 0.14,
    0,
    100,
  )
}

function isQuickTradeStrict(item: {
  warn_grade?: string | null
  entry_grade?: string | null
  trend_grade?: string | null
  liquidity?: number | null
  intraday_change_pct?: number | null
  entry_score?: number | null
  warn_score?: number | null
}): boolean {
  const warn = String(item.warn_grade || '').toUpperCase().trim()
  if (warn === 'SELL') return false
  const entry = String(item.entry_grade || '').toUpperCase().trim()
  const trend = String(item.trend_grade || '').toUpperCase().trim()
  const hasQuality = entry === 'A' || entry === 'B' || trend === 'A' || trend === 'B'
  if (!hasQuality) return false
  const intraday = Number(item.intraday_change_pct ?? 0)
  if (Number.isFinite(intraday) && (intraday < -3.5 || intraday > 8.5)) return false
  if (Number(item.liquidity ?? 0) < 1_000_000_000) return false
  return computeQuickTradeScore(item) >= 58
}

function isQuickTradeLite(item: {
  warn_grade?: string | null
  entry_grade?: string | null
  trend_grade?: string | null
  liquidity?: number | null
  intraday_change_pct?: number | null
  entry_score?: number | null
  warn_score?: number | null
}): boolean {
  const warn = String(item.warn_grade || '').toUpperCase().trim()
  if (warn === 'SELL') return false
  const entry = String(item.entry_grade || '').toUpperCase().trim()
  const trend = String(item.trend_grade || '').toUpperCase().trim()
  const hasQuality = entry === 'A' || entry === 'B' || trend === 'A' || trend === 'B'
  if (!hasQuality) return false
  const intraday = Number(item.intraday_change_pct ?? 0)
  if (Number.isFinite(intraday) && (intraday < -5.5 || intraday > 10.5)) return false
  if (Number(item.liquidity ?? 0) < 500_000_000) return false
  return computeQuickTradeScore(item) >= 52
}

function computeSignalAgeDays(signalDate: string | null | undefined, asOfDate: string): number | null {
  if (!signalDate) return null
  const signalMs = Date.parse(`${signalDate}T00:00:00+09:00`)
  const asOfMs = Date.parse(`${asOfDate}T00:00:00+09:00`)
  if (Number.isNaN(signalMs) || Number.isNaN(asOfMs)) return null
  const diff = asOfMs - signalMs
  if (diff < 0) return null
  return Math.floor(diff / 86_400_000)
}

function shiftDateText(baseDateText: string, days: number): string {
  const base = Date.parse(`${baseDateText}T00:00:00+09:00`)
  if (Number.isNaN(base)) {
    const fallback = new Date(Date.now() - days * 86_400_000)
    return fallback.toISOString().slice(0, 10)
  }
  const shifted = new Date(base - days * 86_400_000)
  return shifted.toISOString().slice(0, 10)
}

async function fetchStockDailyLiquidityByCode(
  supabase: SupabaseClient,
  codes: string[],
  asOfDate: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (codes.length === 0) return map

  const fromDate = shiftDateText(asOfDate, 15)
  const { data } = await supabase
    .from('stock_daily')
    .select('ticker,date,value')
    .in('ticker', codes)
    .gte('date', fromDate)
    .lte('date', asOfDate)
    .order('date', { ascending: false })

  for (const row of data ?? []) {
    const code = String((row as any)?.ticker || '').trim()
    if (!code || map.has(code)) continue
    const value = Number((row as any)?.value)
    if (!Number.isFinite(value) || value <= 0) continue
    map.set(code, value)
  }

  return map
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
    const stockDailyLiquidityByCode = await fetchStockDailyLiquidityByCode(supabase, codes, String(latestDate))
    const realtimeMap = intraday && codes.length > 0
      ? await fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, any>))
      : ({} as Record<string, any>)

    let realtimeAppliedCount = 0

    const rows = (data ?? []).map((row: any) => {
      const stock = Array.isArray(row.stock) ? (row.stock[0] || {}) : (row.stock || {})
      const adaptive = applyAdaptiveOverlayToPullbackCandidate(row, adaptiveInsights)
      const baseScore = Number(row.entry_score ?? 0) * 20 - Number(row.warn_score ?? 0) * 3
      const leadSignal = scoreLeadAccumulationCandidate(row)
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

      const rawStockLiquidity = Number(stock.liquidity)
      const stockLiquidity = Number.isFinite(rawStockLiquidity) && rawStockLiquidity > 0 ? rawStockLiquidity : null
      const liquidity = stockLiquidity ?? indicatorLiquidityByCode.get(String(row.code)) ?? stockDailyLiquidityByCode.get(String(row.code)) ?? null
      const quickScore = computeQuickTradeScore({
        entry_score: row.entry_score,
        warn_score: row.warn_score,
        liquidity,
        intraday_change_pct: hasRealtime ? round2(intradayChangePct) : 0,
      })

      const quickStrict = isQuickTradeStrict({
        warn_grade: row.warn_grade,
        entry_grade: row.entry_grade,
        trend_grade: row.trend_grade,
        liquidity,
        intraday_change_pct: hasRealtime ? round2(intradayChangePct) : 0,
        entry_score: row.entry_score,
        warn_score: row.warn_score,
      })

      const quickLite = isQuickTradeLite({
        warn_grade: row.warn_grade,
        entry_grade: row.entry_grade,
        trend_grade: row.trend_grade,
        liquidity,
        intraday_change_pct: hasRealtime ? round2(intradayChangePct) : 0,
        entry_score: row.entry_score,
        warn_score: row.warn_score,
      })

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
        liquidity,
        close: stock.close ?? null,
        current_price: currentPrice,
        price_source: hasRealtime ? 'realtime' : 'close',
        intraday_change_pct: hasRealtime ? round2(intradayChangePct) : 0,
        stock_updated_at: stock.updated_at ?? null,
        quick_trade_score: round1(quickScore),
        quick_trade_strict: quickStrict,
        quick_trade_lite: quickLite,
        adaptive_adjustment: adaptive.adjustment,
        adaptive_reasons: adaptive.reasons,
        adaptive_score: round1(baseScore + adaptive.adjustment + intradayDelta),
        lead_accumulation_score: leadSignal.score,
        lead_accumulation_stage: leadSignal.stage,
      }
    })

    // 스캔 신호 이력을 DB에 저장(중복은 upsert로 무시)하고, D-n 계산용 최신일을 병합한다.
    try {
      const historyUpserts = rows.map((row: any) => ({
        code: String(row.code),
        trade_date: String(latestDate),
        is_quick_strict: !!row.quick_trade_strict,
        is_quick_lite: !!row.quick_trade_lite,
        quick_score: Number(row.quick_trade_score ?? 0),
      }))

      if (historyUpserts.length > 0) {
        await supabase
          .from('scan_signal_history')
          .upsert(historyUpserts, { onConflict: 'code,trade_date' })
      }

      const historyCodes = rows.map((row: any) => String(row.code)).filter(Boolean)
      if (historyCodes.length > 0) {
        const { data: historyRows } = await supabase
          .from('scan_signal_history')
          .select('code,trade_date,is_quick_strict,is_quick_lite')
          .in('code', historyCodes)
          .lte('trade_date', String(latestDate))
          .order('trade_date', { ascending: false })

        const strictDateByCode = new Map<string, string>()
        const liteDateByCode = new Map<string, string>()

        for (const item of (historyRows ?? []) as SignalHistoryRow[]) {
          const code = String(item.code || '')
          if (!code) continue
          const tradeDate = String(item.trade_date || '')
          if (!tradeDate) continue
          if (item.is_quick_strict && !strictDateByCode.has(code)) strictDateByCode.set(code, tradeDate)
          if (item.is_quick_lite && !liteDateByCode.has(code)) liteDateByCode.set(code, tradeDate)
        }

        for (const row of rows as any[]) {
          const code = String(row.code || '')
          const strictDate = strictDateByCode.get(code) || null
          const liteDate = liteDateByCode.get(code) || null
          row.quick_last_signal_date = strictDate
          row.quick_lite_last_signal_date = liteDate
          row.quick_signal_age_days = computeSignalAgeDays(strictDate, String(latestDate))
          row.quick_lite_signal_age_days = computeSignalAgeDays(liteDate, String(latestDate))
        }
      }
    } catch {
      // 테이블 미구성/권한 이슈가 있어도 기존 스캔 응답은 유지
    }

    rows.sort((a: any, b: any) => {
      const leadDiff = Number(b.lead_accumulation_score ?? 0) - Number(a.lead_accumulation_score ?? 0)
      if (leadDiff !== 0) return leadDiff
      const adaptiveDiff = Number(b.adaptive_score ?? 0) - Number(a.adaptive_score ?? 0)
      if (adaptiveDiff !== 0) return adaptiveDiff
      return Number(b.entry_score ?? 0) - Number(a.entry_score ?? 0)
    })

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
