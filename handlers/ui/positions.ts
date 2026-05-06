import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'
import { fetchRealtimePriceBatch } from '../../src/utils/fetchRealtimePrice'

const POSITIONS_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_POSITIONS_CACHE_TTL_MS || 8_000))
const POSITIONS_LOTS_TIMEOUT_MS = Math.max(120, Number(process.env.UI_POSITIONS_LOTS_TIMEOUT_MS || 300))

type PositionsCacheEntry = {
  expiresAt: number
  payload: any
}

const positionsCache = new Map<string, PositionsCacheEntry>()

// Module-level singleton: reused across warm Vercel invocations → avoids connection cold-start overhead
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
  res.setHeader('Cache-Control', 'private, max-age=8, stale-while-revalidate=30')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const q = req.query || {}
    const qParams: any = req.query || {}
    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(200, Math.max(10, Number(q.pageSize || 20)))
    const withCount = String(qParams.withCount || '') === '1'

    const user = resolveUiUserContext(req)
    const chatId = user.chatId
    if (!chatId) {
      return res.status(200).json({
        data: [],
        count: withCount ? 0 : undefined,
        page,
        pageSize,
      })
    }

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const codeOrQ = String(qParams.q || '').trim()
    const sector = qParams.sector || null
    const minLiquidity = qParams.minLiquidity ? Number(qParams.minLiquidity) : null
    const positionType = String(qParams.positionType || 'all') // 'all' | 'holding' | 'interest'
    const includeLots = String(qParams.includeLots || '0') === '1'
    const bypassCache = String(qParams.cacheMs || '') === '0'

    const cacheKey = JSON.stringify({
      chatId,
      page,
      pageSize,
      codeOrQ,
      sector,
      minLiquidity,
      withCount,
      positionType,
      includeLots,
    })

    if (!bypassCache && POSITIONS_CACHE_TTL_MS > 0) {
      const cached = positionsCache.get(cacheKey)
      if (cached && Date.now() <= cached.expiresAt) {
        return res.status(200).json(cached.payload)
      }
      if (cached) positionsCache.delete(cacheKey)
    }

    // build base query
    let base = withCount
      ? supabase.from('virtual_positions').select('id, chat_id, code, buy_price, buy_date, memo, created_at, updated_at, quantity, invested_amount, status, stock:stocks(code,name,close,sector_id,sector:sectors(id,name))', { count: 'exact' })
      : supabase.from('virtual_positions').select('id, chat_id, code, buy_price, buy_date, memo, created_at, updated_at, quantity, invested_amount, status, stock:stocks(code,name,close,sector_id,sector:sectors(id,name))')

    base = base.eq('chat_id', chatId)

    if (codeOrQ) {
      const like = `%${codeOrQ.replace(/%/g, '')}%`
      base = base.or(`code.ilike.${like},stock->>name.ilike.${like}`)
    }
    if (sector) {
      base = base.eq('stock.sector_id', sector)
    }
    if (minLiquidity != null && !Number.isNaN(minLiquidity)) {
      base = base.gte('stock.liquidity', minLiquidity)
    }

    // Server-side position type filter — reduces rows fetched and enables correct pagination
    if (positionType === 'holding') {
      base = base.gt('quantity', 0)
    } else if (positionType === 'interest') {
      base = base.or('quantity.is.null,quantity.eq.0')
    }

    // id desc is usually indexed as PK and performs better than created_at sort on large tables.
    base = base.order('id', { ascending: false })

    const { data, error, count } = await base.range(from, to)
    if (error) return res.status(500).json({ error: error.message })

    // 현재가 일괄 조회 (포트폴리오 손익 계산용)
    const codes = (data ?? [])
      .map((r: any) => r.code)
      .filter((code: string) => code)
    const realtimePriceMap = codes.length > 0
      ? await fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, { price?: number }>))
      : {}

    // fetch lots only when holding positions exist (skip for interest-only queries)
    const ids = !includeLots || positionType === 'interest' ? [] : (data ?? [])
      .filter((r: any) => Number(r.quantity || 0) > 0)
      .map((r: any) => r.id)
      .filter(Boolean)
    let lotsByPosition: Record<string, any[]> = {}
    if (ids.length) {
      const lotsPromise = supabase
        .from('virtual_trade_lots')
        .select('position_id, acquired_price, acquired_quantity, remaining_quantity, acquired_at')
        .in('position_id', ids)

      const lotsResult = await Promise.race([
        lotsPromise,
        new Promise<{ data: any[]; error: null }>((resolve) => {
          setTimeout(() => resolve({ data: [], error: null }), POSITIONS_LOTS_TIMEOUT_MS)
        }),
      ])
      const lots = lotsResult?.data ?? []
      ;(lots ?? []).forEach((l: any) => {
        const pid = String(l.position_id)
        lotsByPosition[pid] = lotsByPosition[pid] || []
        lotsByPosition[pid].push(l)
      })
    }

    const mapped = (data ?? []).map((row: any) => {
      // 현재가 우선, 없으면 DB 종가 (폴백)
      const code = String(row.code || '').trim()
      const realtimePrice = Number(realtimePriceMap[code]?.price)
      const close = Number.isFinite(realtimePrice) && realtimePrice > 0
        ? realtimePrice
        : row.stock?.close ?? null
      const buyPrice = row.buy_price ?? (row.invested_amount && row.quantity ? Number(row.invested_amount) / Number(row.quantity) : null)
      const unrealized = (close != null && buyPrice != null && row.quantity != null) ? (Number(close) - Number(buyPrice)) * Number(row.quantity) : null
      const percent = (close != null && buyPrice != null && buyPrice > 0) ? ((Number(close) - Number(buyPrice)) / Number(buyPrice)) * 100 : null
      const buyDate = row.buy_date ? new Date(row.buy_date) : null
      const holdDays = buyDate ? Math.floor((Date.now() - buyDate.getTime()) / (1000 * 60 * 60 * 24)) : null

      const pid = String(row.id)
      const lots = lotsByPosition[pid] ?? []

      // recommended additional buy based on invested_amount target
      let recommended_buy_qty: number | null = null
      let recommended_buy_amount: number | null = null
      try {
        const target = row.invested_amount != null ? Number(row.invested_amount) : null
        const currentInvested = (buyPrice != null && row.quantity != null) ? Number(buyPrice) * Number(row.quantity) : 0
        if (target != null && close != null) {
          const remaining = Math.max(0, target - currentInvested)
          recommended_buy_qty = Math.floor(remaining / Number(close))
          recommended_buy_amount = recommended_buy_qty > 0 ? recommended_buy_qty * Number(close) : 0
        } else if (row.quantity == null || row.quantity === 0) {
          // interest-only entry without invested_amount: suggest 1 lot as placeholder
          if (close != null) {
            recommended_buy_qty = 1
            recommended_buy_amount = Number(close)
          }
        }
      } catch (e) {
        recommended_buy_qty = null
        recommended_buy_amount = null
      }

      return {
        ...row,
        symbol: row.code,
        ticker: row.code,
        avg_price: buyPrice,
        unrealized_pnl: unrealized,
        unrealized_pct: percent,
        hold_days: holdDays,
        stock_name: row.stock?.name ?? null,
        position_type: (String(row.status || '').toLowerCase() === 'watch' || String(row.status || '').toLowerCase() === 'interest') ? 'interest' : (row.quantity ? 'holding' : 'interest'),
        lots,
        recommended_buy_qty,
        recommended_buy_amount,
      }
    })

    const payload = {
      data: mapped,
      count: typeof count === 'number' ? count : undefined,
      page,
      pageSize,
    }

    if (!bypassCache && POSITIONS_CACHE_TTL_MS > 0) {
      positionsCache.set(cacheKey, {
        expiresAt: Date.now() + POSITIONS_CACHE_TTL_MS,
        payload,
      })
    }

    return res.status(200).json(payload)
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
