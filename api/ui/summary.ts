import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'

const SUMMARY_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_SUMMARY_CACHE_TTL_MS || 10_000))

type SummaryCacheEntry = {
  expiresAt: number
  payload: any
}

const summaryCache = new Map<string, SummaryCacheEntry>()

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

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const bypassCache = String((req.query as any)?.cacheMs || '') === '0'
  const user = resolveUiUserContext(req)
  const chatId = user.chatId
  if (!chatId) return res.status(400).json({ error: 'chat_id required (header x-user-chat-id, query/body chat_id, or server default)' })

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
    const [{ count: posCount }, { data: positions }, { count: decCount }, { data: lastScan }] = await Promise.all([
      // positions count
      supabase.from('virtual_positions').select('id', { count: 'exact', head: true }).eq('chat_id', chatId),
      // user-scoped unrealized pnl calculation
      supabase
        .from('virtual_positions')
        .select('quantity,buy_price,invested_amount,stock:stocks(close)')
        .eq('chat_id', chatId)
        .gt('quantity', 0),
      // decision logs count
      supabase.from('virtual_decision_logs').select('id', { count: 'exact', head: true }).eq('chat_id', chatId),
      // last scan run
      supabase.from('scan_run_logs').select('created_at').eq('chat_id', chatId).order('created_at', { ascending: false }).limit(1)
    ])

    const unrealizedPnlSum = (positions ?? []).reduce((acc: number, row: any) => {
      const qty = Number(row?.quantity || 0)
      if (qty <= 0) return acc

      const close = Number(row?.stock?.close)
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
