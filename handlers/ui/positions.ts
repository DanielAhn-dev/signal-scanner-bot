import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'
import {
  fetchRealtimePriceBatch,
  logRealtimeCoverageMetric,
  type RealtimeStockData,
} from '../../src/utils/fetchRealtimePrice'

const POSITIONS_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_POSITIONS_CACHE_TTL_MS || 8_000))
const POSITIONS_LOTS_TIMEOUT_MS = Math.max(120, Number(process.env.UI_POSITIONS_LOTS_TIMEOUT_MS || 300))

type PositionsCacheEntry = {
  expiresAt: number
  payload: any
}

const positionsCache = new Map<string, PositionsCacheEntry>()

function normalizeDateKey(raw: unknown): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  const ymd = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (ymd?.[1]) return ymd[1]
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function toPositiveNumber(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,x-user-client-id,Authorization')
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

    const user = await resolveUiUserContext(req)
    const filterColumn = user.clientId ? 'client_id' : (user.chatId ? 'chat_id' : null)
    const filterValue = user.clientId || user.chatId || null
    if (!filterColumn || !filterValue) {
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
    const brokerName = String(qParams.brokerName || '').trim()
    const accountName = String(qParams.accountName || '').trim()
    const positionType = String(qParams.positionType || 'all') // 'all' | 'holding' | 'interest'
    const includeLots = String(qParams.includeLots || '0') === '1'
    const bypassCache = String(qParams.cacheMs || '') === '0'

    const cacheKey = JSON.stringify({
      filterColumn,
      filterValue,
      page,
      pageSize,
      codeOrQ,
      sector,
      minLiquidity,
      brokerName,
      accountName,
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
      ? supabase.from('virtual_positions').select('id, chat_id, client_id, code, buy_price, buy_date, memo, created_at, updated_at, quantity, invested_amount, status, broker_name, account_name, stock:stocks(code,name,close,sector_id,sector:sectors(id,name))', { count: 'exact' })
      : supabase.from('virtual_positions').select('id, chat_id, client_id, code, buy_price, buy_date, memo, created_at, updated_at, quantity, invested_amount, status, broker_name, account_name, stock:stocks(code,name,close,sector_id,sector:sectors(id,name))')

    base = base.eq(filterColumn, filterValue)

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
    if (brokerName) {
      base = base.eq('broker_name', brokerName)
    }
    if (accountName) {
      base = base.eq('account_name', accountName)
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
      ? await fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, RealtimeStockData>))
      : {}

    const scoreByCode = new Map<string, { totalScore: number | null; signal: string | null }>()
    if (codes.length > 0) {
      const { data: latestScoreRows } = await supabase
        .from('scores')
        .select('asof')
        .order('asof', { ascending: false })
        .limit(1)
      const latestAsof = (latestScoreRows?.[0]?.asof as string) ?? null
      if (latestAsof) {
        const { data: scoreRows } = await supabase
          .from('scores')
          .select('code, total_score, signal')
          .eq('asof', latestAsof)
          .in('code', codes)
        for (const row of (scoreRows ?? []) as any[]) {
          scoreByCode.set(String(row.code || ''), {
            totalScore: Number.isFinite(Number(row?.total_score)) ? Number(row.total_score) : null,
            signal: String(row?.signal || '').trim() || null,
          })
        }
      }
    }

    const pullbackByCode = new Map<string, {
      entryGrade: string | null
      trendGrade: string | null
      warnGrade: string | null
      warnScore: number | null
      warnOverheat: boolean | null
      warnVolSpike: boolean | null
      warnAtrSpike: boolean | null
      warnRsiOb: boolean | null
      warnMaBreak: boolean | null
      warnDeadCross: boolean | null
    }>()
    if (codes.length > 0) {
      const { data: latestPullbackRows } = await supabase
        .from('pullback_signals')
        .select('trade_date')
        .order('trade_date', { ascending: false })
        .limit(1)
      const latestTradeDate = (latestPullbackRows?.[0]?.trade_date as string) ?? null
      if (latestTradeDate) {
        const { data: pullbackRows } = await supabase
          .from('pullback_signals')
          .select('code, entry_grade, trend_grade, warn_grade, warn_score, warn_overheat, warn_vol_spike, warn_atr_spike, warn_rsi_ob, warn_ma_break, warn_dead_cross')
          .eq('trade_date', latestTradeDate)
          .in('code', codes)
        for (const row of (pullbackRows ?? []) as any[]) {
          pullbackByCode.set(String(row.code || ''), {
            entryGrade: String(row?.entry_grade || '').trim().toUpperCase() || null,
            trendGrade: String(row?.trend_grade || '').trim().toUpperCase() || null,
            warnGrade: String(row?.warn_grade || '').trim().toUpperCase() || null,
            warnScore: Number.isFinite(Number(row?.warn_score)) ? Number(row.warn_score) : null,
            warnOverheat: typeof row?.warn_overheat === 'boolean' ? row.warn_overheat : null,
            warnVolSpike: typeof row?.warn_vol_spike === 'boolean' ? row.warn_vol_spike : null,
            warnAtrSpike: typeof row?.warn_atr_spike === 'boolean' ? row.warn_atr_spike : null,
            warnRsiOb: typeof row?.warn_rsi_ob === 'boolean' ? row.warn_rsi_ob : null,
            warnMaBreak: typeof row?.warn_ma_break === 'boolean' ? row.warn_ma_break : null,
            warnDeadCross: typeof row?.warn_dead_cross === 'boolean' ? row.warn_dead_cross : null,
          })
        }
      }
    }

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

    const addedCloseTargetRows = (data ?? []).map((row: any) => {
      const code = String(row?.code || '').trim()
      const addedDateKey = normalizeDateKey(row?.buy_date || row?.created_at)
      const baseBuyPrice = toPositiveNumber(
        row?.buy_price ?? ((row?.invested_amount && row?.quantity) ? Number(row.invested_amount) / Number(row.quantity) : null),
      )
      return {
        code,
        addedDateKey,
        needsFallback: !!code && !!addedDateKey && baseBuyPrice == null,
      }
    }).filter((r: { needsFallback: boolean }) => r.needsFallback)

    const addedCloseByCodeDate = new Map<string, number>()
    if (addedCloseTargetRows.length > 0) {
      const codesForAddedClose = Array.from(new Set(addedCloseTargetRows.map((r) => String(r.code))))
      const datesForAddedClose = Array.from(new Set(addedCloseTargetRows.map((r) => String(r.addedDateKey))))
      const minAddedDate = datesForAddedClose.reduce((min, cur) => (cur < min ? cur : min), datesForAddedClose[0])
      const maxAddedDate = datesForAddedClose.reduce((max, cur) => (cur > max ? cur : max), datesForAddedClose[0])
      const lookupStartDate = shiftDateKey(minAddedDate, -45)
      const { data: addedCloseRows } = await supabase
        .from('daily_indicators')
        .select('code, trade_date, close')
        .in('code', codesForAddedClose)
        .gte('trade_date', lookupStartDate)
        .lte('trade_date', maxAddedDate)
        .order('trade_date', { ascending: true })

      const closeSeriesByCode = new Map<string, Array<{ tradeDate: string; close: number }>>()

      for (const row of (addedCloseRows ?? []) as any[]) {
        const code = String(row?.code || '').trim()
        const tradeDate = normalizeDateKey(row?.trade_date)
        const close = toPositiveNumber(row?.close)
        if (!code || !tradeDate || close == null) continue
        const list = closeSeriesByCode.get(code) ?? []
        list.push({ tradeDate, close })
        closeSeriesByCode.set(code, list)
      }

      for (const target of addedCloseTargetRows) {
        const code = String(target.code)
        const addedDateKey = String(target.addedDateKey)
        const series = closeSeriesByCode.get(code) ?? []
        let matchedClose: number | null = null
        for (let i = series.length - 1; i >= 0; i -= 1) {
          if (series[i].tradeDate <= addedDateKey) {
            matchedClose = series[i].close
            break
          }
        }
        if (matchedClose != null) {
          addedCloseByCodeDate.set(`${code}|${addedDateKey}`, matchedClose)
        }
      }
    }

    let fallbackToCloseCount = 0
    const mapped = (data ?? []).map((row: any) => {
      // 현재가 우선, 없으면 DB 종가 (폴백)
      const code = String(row.code || '').trim()
      const realtimePrice = Number(realtimePriceMap[code]?.price)
      const hasRealtime = Number.isFinite(realtimePrice) && realtimePrice > 0
      const closeFallback = Number(row.stock?.close)
      const close = hasRealtime
        ? realtimePrice
        : (Number.isFinite(closeFallback) ? closeFallback : null)
      if (!hasRealtime && Number.isFinite(closeFallback)) fallbackToCloseCount += 1
      const addedDateKey = normalizeDateKey(row.buy_date || row.created_at)
      const baseBuyPrice = toPositiveNumber(
        row.buy_price ?? ((row.invested_amount && row.quantity) ? Number(row.invested_amount) / Number(row.quantity) : null),
      )
      const addedCloseFallback = (code && addedDateKey)
        ? (addedCloseByCodeDate.get(`${code}|${addedDateKey}`) ?? null)
        : null
      const buyPrice = baseBuyPrice ?? addedCloseFallback
      const addedPriceSource = baseBuyPrice != null ? 'position' : (addedCloseFallback != null ? 'daily_indicators' : null)
      const unrealized = (close != null && buyPrice != null && row.quantity != null) ? (Number(close) - Number(buyPrice)) * Number(row.quantity) : null
      const percent = (close != null && buyPrice != null && buyPrice > 0) ? ((Number(close) - Number(buyPrice)) / Number(buyPrice)) * 100 : null
      const referenceDate = (row.buy_date || row.created_at) ? new Date(row.buy_date || row.created_at) : null
      const holdDays = (referenceDate && !Number.isNaN(referenceDate.getTime()))
        ? Math.max(0, Math.floor((Date.now() - referenceDate.getTime()) / (1000 * 60 * 60 * 24)))
        : null

      const pid = String(row.id)
      const lots = lotsByPosition[pid] ?? []
      const score = scoreByCode.get(code)
      const pullback = pullbackByCode.get(code)

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
        // interest-only entry: no recommended qty (leave null, avoid misleading 1-lot placeholder)
        }
      } catch (e) {
        recommended_buy_qty = null
        recommended_buy_amount = null
      }

      return {
        ...row,
        symbol: row.code,
        ticker: row.code,
        broker_name: row.broker_name ?? null,
        account_name: row.account_name ?? null,
        account_kind: (!String(row.broker_name || '').trim() && !String(row.account_name || '').trim()) ? 'virtual' : 'account',
        account_label: [row.broker_name, row.account_name].filter(Boolean).join(' / ') || null,
        avg_price: buyPrice,
        added_price: buyPrice,
        added_price_source: addedPriceSource,
        added_reference_date: addedDateKey,
        current_price: close ?? null,
        unrealized_pnl: unrealized,
        unrealized_pct: percent,
        hold_days: holdDays,
        stock_name: row.stock?.name ?? null,
        total_score: score?.totalScore ?? null,
        score_signal: score?.signal ?? null,
        entry_grade: pullback?.entryGrade ?? null,
        trend_grade: pullback?.trendGrade ?? null,
        warn_grade: pullback?.warnGrade ?? null,
        warn_score: pullback?.warnScore ?? null,
        warn_overheat: pullback?.warnOverheat ?? null,
        warn_vol_spike: pullback?.warnVolSpike ?? null,
        warn_atr_spike: pullback?.warnAtrSpike ?? null,
        warn_rsi_ob: pullback?.warnRsiOb ?? null,
        warn_ma_break: pullback?.warnMaBreak ?? null,
        warn_dead_cross: pullback?.warnDeadCross ?? null,
        position_type: (String(row.status || '').toLowerCase() === 'watch' || String(row.status || '').toLowerCase() === 'interest') ? 'interest' : (row.quantity ? 'holding' : 'interest'),
        lots,
        recommended_buy_qty,
        recommended_buy_amount,
      }
    })

    const accountMap = new Map<string, { brokerName: string; accountName: string; count: number }>()
    for (const row of mapped) {
      const b = String(row?.broker_name || '').trim()
      const a = String(row?.account_name || '').trim()
      if (!b && !a) continue
      const key = `${b}|||${a}`
      const prev = accountMap.get(key)
      accountMap.set(key, {
        brokerName: b,
        accountName: a,
        count: (prev?.count ?? 0) + 1,
      })
    }
    const accounts = Array.from(accountMap.values()).sort((x, y) => {
      const labelX = `${x.brokerName} ${x.accountName}`.trim()
      const labelY = `${y.brokerName} ${y.accountName}`.trim()
      return labelX.localeCompare(labelY, 'ko')
    })

    const payload = {
      data: mapped,
      accounts,
      count: typeof count === 'number' ? count : undefined,
      page,
      pageSize,
    }

    logRealtimeCoverageMetric({
      context: 'ui.positions',
      requestedCodes: codes,
      realtimeMap: realtimePriceMap,
      fallbackToCloseCount,
      extra: {
        audience: `${filterColumn}:${String(filterValue)}`,
        page,
        pageSize,
        positionType,
      },
    })

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
