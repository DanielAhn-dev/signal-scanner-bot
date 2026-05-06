import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'
import {
  fetchRealtimePriceBatch,
  logRealtimeCoverageMetric,
  type RealtimeStockData,
} from '../../src/utils/fetchRealtimePrice'

const SUMMARY_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_SUMMARY_CACHE_TTL_MS || 10_000))
const SUMMARY_QUERY_TIMEOUT_MS = Math.max(1_000, Number(process.env.UI_SUMMARY_QUERY_TIMEOUT_MS || 7_000))

type PositionSummaryRow = {
  code: string | null
  quantity: number | null
  buy_price: number | null
  invested_amount: number | null
  stock: { code: string | null; close: number | null } | Array<{ code: string | null; close: number | null }> | null
}

type ScanRunRow = {
  created_at: string | null
}

type QueryWithData<T> = {
  data: T[] | null
}

type QueryWithCount = {
  count: number | null
}

type SummaryCacheEntry = {
  expiresAt: number
  payload: any
}

const summaryCache = new Map<string, SummaryCacheEntry>()

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
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
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
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

  const bypassCache = String((req.query as any)?.cacheMs || '') === '0'
  const user = resolveUiUserContext(req)
  const chatId = user.chatId
  if (!chatId) {
    return res.status(200).json({
      data: {
        positions: 0,
        decisions: 0,
        unrealized_pnl_sum: null,
        last_scan_at: null,
      },
    })
  }

  const cacheKey = `summary:${chatId}`
  if (!bypassCache && SUMMARY_CACHE_TTL_MS > 0) {
    const cached = summaryCache.get(cacheKey)
    if (cached && Date.now() <= cached.expiresAt) {
      return res.status(200).json(cached.payload)
    }
    if (cached) summaryCache.delete(cacheKey)
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const positionsResult = await withTimeout<QueryWithData<PositionSummaryRow>>(
      supabase
        .from('virtual_positions')
        .select('id,code,quantity,buy_price,invested_amount,stock:stocks(code,close)')
        .eq('chat_id', chatId)
        .gt('quantity', 0)
        .returns<PositionSummaryRow[]>(),
      SUMMARY_QUERY_TIMEOUT_MS,
      'virtual_positions summary query',
    )

    const [decisionResult, lastScanResult] = await Promise.allSettled([
      withTimeout<QueryWithCount>(
        supabase
          .from('virtual_decision_logs')
          .select('id', { count: 'planned', head: true })
          .eq('chat_id', chatId),
        SUMMARY_QUERY_TIMEOUT_MS,
        'virtual_decision_logs summary query',
      ),
      withTimeout<QueryWithData<ScanRunRow>>(
        supabase
          .from('scan_run_logs')
          .select('created_at')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: false })
          .limit(1)
          .returns<ScanRunRow[]>(),
        SUMMARY_QUERY_TIMEOUT_MS,
        'scan_run_logs summary query',
      ),
    ])

    const positions: PositionSummaryRow[] = positionsResult.data ?? []
    const posCount = positions.length

    const positionCodes = positions
      .map((row) => String(row?.code || '').trim())
      .filter(Boolean)
    const realtimePriceMap = await fetchRealtimePriceBatch(positionCodes).catch(
      () => ({} as Record<string, RealtimeStockData>),
    )

    const decCount =
      decisionResult.status === 'fulfilled' && Number.isFinite(Number(decisionResult.value.count))
        ? Number(decisionResult.value.count)
        : 0

    const lastScan: ScanRunRow[] =
      lastScanResult.status === 'fulfilled'
        ? (lastScanResult.value.data ?? [])
        : []

    let fallbackToCloseCount = 0
    const unrealizedPnlSum = (positions ?? []).reduce((acc: number, row: any) => {
      const qty = Number(row?.quantity || 0)
      if (qty <= 0) return acc

      const stock = Array.isArray(row?.stock) ? row.stock[0] : row?.stock
      const code = String(row?.code || stock?.code || '').trim()
      const realtimePrice = Number(realtimePriceMap[code]?.price)
      const hasRealtime = Number.isFinite(realtimePrice) && realtimePrice > 0
      const closeFallback = Number(stock?.close)
      const close = hasRealtime
        ? realtimePrice
        : closeFallback
      if (!hasRealtime && Number.isFinite(closeFallback)) fallbackToCloseCount += 1
      let avg = Number(row?.buy_price)
      if (!Number.isFinite(avg) || avg <= 0) {
        const invested = Number(row?.invested_amount)
        avg = qty > 0 && Number.isFinite(invested) ? invested / qty : NaN
      }

      if (!Number.isFinite(close) || !Number.isFinite(avg)) return acc
      return acc + (close - avg) * qty
    }, 0)

    const summary = {
      positions: posCount ?? 0,
      decisions: decCount ?? 0,
      unrealized_pnl_sum: Number.isFinite(unrealizedPnlSum) ? unrealizedPnlSum : null,
      last_scan_at: lastScan && lastScan.length ? lastScan[0].created_at : null
    }

    logRealtimeCoverageMetric({
      context: 'ui.summary',
      requestedCodes: positionCodes,
      realtimeMap: realtimePriceMap,
      fallbackToCloseCount,
      extra: { chatId, positions: posCount ?? 0 },
    })

    const payload = { data: summary }
    if (!bypassCache && SUMMARY_CACHE_TTL_MS > 0) {
      summaryCache.set(cacheKey, {
        expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS,
        payload,
      })
    }

    return res.status(200).json(payload)
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
