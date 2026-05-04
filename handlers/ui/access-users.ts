import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  evaluateAdvancedAccess,
  getAccessTableName,
  getSupabaseAdminForUi,
  isAdminChatId,
  resolveRequesterChatId,
} from './_accessControl'

function toChatId(raw: unknown): number | null {
  const n = Number(String(raw ?? '').trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.trunc(n)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const requesterChatId = resolveRequesterChatId(req)
  const isAdmin = isAdminChatId(requesterChatId)
  const supabase = getSupabaseAdminForUi()
  if (!supabase) return res.status(500).json({ error: 'Server not configured' })

  const mode = String(req.query.mode || '')
  const table = getAccessTableName()

  try {
    if (req.method === 'GET' && mode === 'me') {
      const access = await evaluateAdvancedAccess(requesterChatId)
      return res.status(200).json({
        data: {
          chat_id: requesterChatId,
          is_admin: access.isAdmin,
          has_advanced_access: access.hasAdvancedAccess,
        },
      })
    }

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin only' })
    }

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from(table)
        .select('chat_id,nickname,note,is_enabled,updated_by_chat_id,created_at,updated_at')
        .order('updated_at', { ascending: false })

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ data: data || [] })
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      const targetChatId = toChatId(body.chat_id ?? body.chatId)
      if (!targetChatId) return res.status(400).json({ error: 'chat_id required' })

      const payload = {
        chat_id: targetChatId,
        nickname: body.nickname ? String(body.nickname) : null,
        note: body.note ? String(body.note) : null,
        is_enabled: body.is_enabled !== false,
        updated_by_chat_id: requesterChatId,
      }

      const { data, error } = await supabase
        .from(table)
        .upsert(payload, { onConflict: 'chat_id' })
        .select('chat_id,nickname,note,is_enabled,updated_by_chat_id,created_at,updated_at')
        .limit(1)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ data: data && data[0] ? data[0] : payload })
    }

    if (req.method === 'PATCH') {
      const body = req.body || {}
      const targetChatId = toChatId(body.chat_id ?? body.chatId)
      if (!targetChatId) return res.status(400).json({ error: 'chat_id required' })

      const patch: Record<string, unknown> = {
        updated_by_chat_id: requesterChatId,
      }
      if (body.nickname !== undefined) patch.nickname = body.nickname ? String(body.nickname) : null
      if (body.note !== undefined) patch.note = body.note ? String(body.note) : null
      if (body.is_enabled !== undefined) patch.is_enabled = Boolean(body.is_enabled)

      const { data, error } = await supabase
        .from(table)
        .update(patch)
        .eq('chat_id', targetChatId)
        .select('chat_id,nickname,note,is_enabled,updated_by_chat_id,created_at,updated_at')
        .limit(1)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ data: data && data[0] ? data[0] : null })
    }

    if (req.method === 'DELETE') {
      const body = req.body || {}
      const targetChatId = toChatId(body.chat_id ?? body.chatId ?? req.query.chat_id ?? req.query.chatId)
      if (!targetChatId) return res.status(400).json({ error: 'chat_id required' })

      const { error } = await supabase
        .from(table)
        .delete()
        .eq('chat_id', targetChatId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
