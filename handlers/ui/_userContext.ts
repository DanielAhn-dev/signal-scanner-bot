import type { VercelRequest } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type UiUserContext = {
  chatId: number | null
  source: 'auth' | 'header' | 'query' | 'body' | 'env' | 'none'
}

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return null
  _supabase = createClient(url, key, { auth: { persistSession: false } })
  return _supabase
}

function toChatId(raw: unknown): number | null {
  const v = String(raw ?? '').trim()
  if (!v) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.trunc(n)
}

export async function resolveUiUserContext(req: VercelRequest): Promise<UiUserContext> {
  const authHeader = String(req.headers.authorization || '').trim()
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''

  if (bearer) {
    const supabase = getSupabase()
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
    if (supabase && url && key) {
      try {
        const authRes = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
          method: 'GET',
          headers: {
            apikey: key,
            Authorization: `Bearer ${bearer}`,
          },
        })
        if (authRes.ok) {
          const authData = await authRes.json().catch(() => null) as { id?: string } | null
          const clientId = String(authData?.id || '').trim()
          if (clientId) {
            const { data } = await supabase
              .from('web_user_profiles')
              .select('telegram_id')
              .eq('client_id', clientId)
              .maybeSingle()
            const chatId = toChatId(data?.telegram_id)
            if (chatId) return { chatId, source: 'auth' }
          }
        }
      } catch {
        // fall through to legacy sources
      }
    }
  }

  const fromHeader = toChatId(req.headers['x-user-chat-id'])
  if (fromHeader) return { chatId: fromHeader, source: 'header' }

  const q = req.query || {}
  const fromQuery = toChatId((q as any).chat_id ?? (q as any).chatId)
  if (fromQuery) return { chatId: fromQuery, source: 'query' }

  const body = (req.body || {}) as any
  const fromBody = toChatId(body.chat_id ?? body.chatId)
  if (fromBody) return { chatId: fromBody, source: 'body' }

  const fromEnv = toChatId(
    process.env.DEFAULT_TELEGRAM_CHAT_ID ||
    process.env.TELEGRAM_DEFAULT_CHAT_ID ||
    process.env.VITE_DEFAULT_TELEGRAM_CHAT_ID,
  )
  if (fromEnv) return { chatId: fromEnv, source: 'env' }

  return { chatId: null, source: 'none' }
}
