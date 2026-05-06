import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'

const DECISIONS_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_DECISIONS_CACHE_TTL_MS || 5_000))

type DecisionsCacheEntry = {
  expiresAt: number
  payload: any
}

const decisionsCache = new Map<string, DecisionsCacheEntry>()

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

    const user = resolveUiUserContext(req)
    const chatId = user.chatId
    if (!chatId) return res.status(200).json({ data: [], count: withCount ? 0 : undefined, page, pageSize })

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const bypassCache = String((q as any).cacheMs || '') === '0'
    const cacheKey = JSON.stringify({ chatId, page, pageSize, withCount })

    if (!bypassCache && DECISIONS_CACHE_TTL_MS > 0) {
      const cached = decisionsCache.get(cacheKey)
      if (cached && Date.now() <= cached.expiresAt) {
        return res.status(200).json(cached.payload)
      }
      if (cached) decisionsCache.delete(cacheKey)
    }

    const query = withCount
      ? supabase.from('virtual_decision_logs').select('*', { count: 'exact' }).eq('chat_id', chatId).order('created_at', { ascending: false })
      : supabase.from('virtual_decision_logs').select('*').eq('chat_id', chatId).order('created_at', { ascending: false })

    const { data, error, count } = await query.range(from, to)

    if (error) return res.status(500).json({ error: error.message })
    const payload = { data: data ?? [], count: withCount ? (count ?? 0) : undefined, page, pageSize }

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
