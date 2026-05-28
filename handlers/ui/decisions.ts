import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'

const DECISIONS_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_DECISIONS_CACHE_TTL_MS || 5_000))

type DecisionsCacheEntry = {
  expiresAt: number
  payload: any
}

const decisionsCache = new Map<string, DecisionsCacheEntry>()

function toNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function formatMoney(value: unknown): string | null {
  const num = toNumber(value)
  if (num == null) return null
  return `${Math.round(num).toLocaleString('ko-KR')}원`
}

function formatPct(value: unknown): string | null {
  const num = toNumber(value)
  if (num == null) return null
  return `${num.toFixed(2)}%`
}

function normalizeTrigger(raw: unknown): string {
  return String(raw ?? '').trim()
}

function escapeLikeQuery(value: string): string {
  return value.replace(/[%_,]/g, ' ').trim()
}

function buildDetailLines(action: string, reasonDetails: unknown): string[] {
  if (!reasonDetails || typeof reasonDetails !== 'object') return []
  const d = reasonDetails as Record<string, unknown>
  const lines: string[] = []

  const trigger = normalizeTrigger(d.trigger)
  if (trigger) lines.push(`trigger: ${trigger}`)

  const strategyProfile = String(d.strategyProfile ?? '').trim()
  if (strategyProfile) lines.push(`profile: ${strategyProfile}`)

  const score = toNumber(d.score)
  if (score != null) lines.push(`score: ${score.toFixed(1)}`)

  const qty = toNumber(d.qty ?? d.sellQty ?? d.addOnQty)
  if (qty != null && qty > 0) lines.push(`qty: ${Math.floor(qty)}주`)

  const price = formatMoney(d.price ?? d.sellPrice)
  if (price) lines.push(`price: ${price}`)

  const buyPrice = formatMoney(d.buyPrice)
  if (buyPrice && action === 'SELL') lines.push(`buy_price: ${buyPrice}`)

  const invested = formatMoney(d.investedAmount ?? d.addOnInvested)
  if (invested) lines.push(`invested: ${invested}`)

  const pnl = formatMoney(d.pnl)
  if (pnl && action === 'SELL') lines.push(`realized_pnl: ${pnl}`)

  const rr = toNumber(d.expectedRr)
  if (rr != null) lines.push(`expected_rr: ${rr.toFixed(2)}`)

  const trust = d.signalTrust
  if (trust && typeof trust === 'object') {
    const trustObj = trust as Record<string, unknown>
    const trustScore = toNumber(trustObj.score)
    const trustGrade = String(trustObj.grade ?? '').trim()
    if (trustScore != null || trustGrade) {
      const parts = [
        trustScore != null ? `score ${trustScore.toFixed(1)}` : '',
        trustGrade ? `grade ${trustGrade}` : '',
      ].filter(Boolean)
      if (parts.length) lines.push(`signal_trust: ${parts.join(' / ')}`)
    }
  }

  const priceSource = String(d.priceSource ?? '').trim()
  if (priceSource) lines.push(`price_source: ${priceSource}`)

  const marketMode = String(d.marketMode ?? '').trim()
  const marketReason = String(d.marketReason ?? '').trim()
  if (marketMode || marketReason) {
    lines.push(`market: ${[marketMode, marketReason].filter(Boolean).join(' / ')}`)
  }

  return lines
}

function deriveAutoFlag(row: Record<string, unknown>): boolean {
  const strategyId = String(row.strategy_id ?? '').toLowerCase()
  const summary = String(row.reason_summary ?? row.reason ?? '').toLowerCase()
  const reasonDetails = row.reason_details
  const trigger =
    reasonDetails && typeof reasonDetails === 'object'
      ? String((reasonDetails as Record<string, unknown>).trigger ?? '').toLowerCase()
      : ''

  return (
    strategyId.includes('auto') ||
    summary.startsWith('자동') ||
    summary.includes('autotrade') ||
    trigger.includes('auto')
  )
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,x-user-client-id,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Cache-Control', 'private, max-age=3, stale-while-revalidate=20')
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
    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(1000, Math.max(10, Number(q.pageSize || 50)))
    const withCount = String(q.withCount || '') === '1'
    const keyword = String(q.q || '').trim()
    const actionFilterRaw = String(q.action || '').trim().toUpperCase()
    const actionFilter = actionFilterRaw === 'BUY' || actionFilterRaw === 'SELL' ? actionFilterRaw : ''
    const modeFilterRaw = String(q.mode || '').trim().toLowerCase()
    const modeFilter = modeFilterRaw === 'auto' || modeFilterRaw === 'manual' ? modeFilterRaw : 'all'

    const user = await resolveUiUserContext(req)
    const filterColumn = user.clientId ? 'client_id' : (user.chatId ? 'chat_id' : null)
    const filterValue = user.clientId || user.chatId || null
    if (!filterColumn || !filterValue) return res.status(200).json({ data: [], count: withCount ? 0 : undefined, page, pageSize })

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const bypassCache = String((q as any).cacheMs || '') === '0'
    const cacheKey = JSON.stringify({ filterColumn, filterValue, page, pageSize, withCount, keyword, actionFilter, modeFilter })

    if (!bypassCache && DECISIONS_CACHE_TTL_MS > 0) {
      const cached = decisionsCache.get(cacheKey)
      if (cached && Date.now() <= cached.expiresAt) {
        return res.status(200).json(cached.payload)
      }
      if (cached) decisionsCache.delete(cacheKey)
    }

    const query = withCount
      ? supabase.from('virtual_decision_logs').select('*', { count: 'exact' }).eq(filterColumn, filterValue).order('created_at', { ascending: false })
      : supabase.from('virtual_decision_logs').select('*').eq(filterColumn, filterValue).order('created_at', { ascending: false })

    if (actionFilter) {
      query.eq('action', actionFilter)
    }

    if (keyword) {
      const safeKeyword = escapeLikeQuery(keyword)
      if (safeKeyword) {
        const like = `%${safeKeyword}%`
        query.or(`code.ilike.${like},reason_summary.ilike.${like},reason.ilike.${like},strategy_id.ilike.${like}`)
      }
    }

    let rows: Array<Record<string, unknown>> = []
    let matchedCount: number | undefined

    if (modeFilter === 'all') {
      const { data, error, count } = await query.range(from, to)
      if (error) return res.status(500).json({ error: error.message })
      rows = (data ?? []) as Array<Record<string, unknown>>
      matchedCount = withCount ? (count ?? 0) : undefined
    } else {
      const { data, error } = await query
      if (error) return res.status(500).json({ error: error.message })

      const allRows = (data ?? []) as Array<Record<string, unknown>>
      const filteredByMode = allRows.filter((row) => {
        const isAuto = deriveAutoFlag(row)
        return modeFilter === 'auto' ? isAuto : !isAuto
      })

      rows = filteredByMode.slice(from, to + 1)
      matchedCount = withCount ? filteredByMode.length : undefined
    }
    const codes = Array.from(
      new Set(
        rows
          .map((row) => String(row.code ?? '').trim())
          .filter(Boolean)
      )
    )

    const stockNameByCode = new Map<string, string>()
    if (codes.length) {
      const { data: stockRows } = await supabase
        .from('stocks')
        .select('code,name')
        .in('code', codes)

      for (const row of (stockRows ?? []) as Array<{ code?: string | null; name?: string | null }>) {
        const code = String(row.code ?? '').trim()
        const name = String(row.name ?? '').trim()
        if (code && name) stockNameByCode.set(code, name)
      }
    }

    const normalizedRows = rows.map((row) => {
      const code = String(row.code ?? '').trim()
      const reasonSummary = String(row.reason_summary ?? row.reason ?? '').trim()
      const reasonDetails = row.reason_details
      const action = String(row.action ?? '').toUpperCase()
      const stockName = String(row.stock_name ?? '').trim() || stockNameByCode.get(code) || code
      const detailLines = buildDetailLines(action, reasonDetails)

      return {
        ...row,
        code,
        stock_name: stockName,
        reason: reasonSummary,
        reason_summary: reasonSummary,
        reason_details: reasonDetails && typeof reasonDetails === 'object' ? reasonDetails : null,
        buy_reason: action === 'BUY' ? reasonSummary : null,
        sell_reason: action === 'SELL' ? reasonSummary : null,
        detail_lines: detailLines,
        trigger_label:
          reasonDetails && typeof reasonDetails === 'object'
            ? normalizeTrigger((reasonDetails as Record<string, unknown>).trigger)
            : '',
        is_auto: deriveAutoFlag(row),
        pnl_pct: action === 'SELL' && toNumber((reasonDetails as Record<string, unknown> | null)?.buyPrice) && toNumber((reasonDetails as Record<string, unknown> | null)?.sellPrice)
          ? formatPct(
              ((Number((reasonDetails as Record<string, unknown>).sellPrice) - Number((reasonDetails as Record<string, unknown>).buyPrice)) /
                Number((reasonDetails as Record<string, unknown>).buyPrice)) *
                100
            )
          : null,
      }
    })

    const payload = { data: normalizedRows, count: matchedCount, page, pageSize }

    if (!bypassCache && DECISIONS_CACHE_TTL_MS > 0) {
      decisionsCache.set(cacheKey, {
        expiresAt: Date.now() + DECISIONS_CACHE_TTL_MS,
        payload,
      })
    }

    return res.status(200).json(payload)
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
