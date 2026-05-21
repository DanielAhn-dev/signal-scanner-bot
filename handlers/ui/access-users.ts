import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  evaluateAdvancedAccess,
  getAccessTableName,
  getSupabaseAdminForUi,
  resolveRequesterChatId,
} from './_accessControl'

function toChatId(raw: unknown): number | null {
  const n = Number(String(raw ?? '').trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.trunc(n)
}

function normalizeQuery(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
}

function includesQuery(value: unknown, q: string): boolean {
  if (!q) return true
  return String(value ?? '').toLowerCase().includes(q)
}

function toPositiveInt(raw: unknown, fallback: number): number {
  const n = Number(String(raw ?? '').trim())
  if (!Number.isFinite(n) || n <= 0) return fallback
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

  const requesterChatId = await resolveRequesterChatId(req)
  const requesterAccess = await evaluateAdvancedAccess(requesterChatId)
  const isAdmin = requesterAccess.isAdmin
  const supabase = getSupabaseAdminForUi()
  if (!supabase) return res.status(500).json({ error: 'Server not configured' })

  const mode = String(req.query.mode || '')
  const table = getAccessTableName()

  try {
    if (req.method === 'GET' && mode === 'me') {
      // 오너는 최초 접근 시 DB에도 자동 등록(bootstrap)
      if (requesterChatId && requesterAccess.isAdmin) {
        const ownerEnvId = Number(process.env.TELEGRAM_OWNER_USER_ID ?? '0')
        const isEnvOwner = ownerEnvId > 0 && requesterChatId === ownerEnvId
        if (isEnvOwner) {
          await supabase
            .from(table)
            .upsert(
              { chat_id: requesterChatId, is_enabled: true, is_admin: true },
              { onConflict: 'chat_id', ignoreDuplicates: false }
            )
        }
      }

      return res.status(200).json({
        data: {
          chat_id: requesterChatId,
          is_admin: requesterAccess.isAdmin,
          has_advanced_access: requesterAccess.hasAdvancedAccess,
        },
      })
    }

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin only' })
    }

    if (req.method === 'GET') {
      if (mode === 'directory') {
        const q = normalizeQuery(req.query.q)
        const page = Math.max(1, toPositiveInt(req.query.page, 1))
        const pageSize = Math.min(200, Math.max(10, toPositiveInt(req.query.page_size, 50)))

        const [accessResult, tgUsersResult, webProfilesResult] = await Promise.all([
          supabase
            .from(table)
            .select('chat_id,nickname,note,is_enabled,is_admin,updated_at')
            .order('updated_at', { ascending: false })
            .limit(5000),
          supabase
            .from('users')
            .select('tg_id,username,first_name,last_active_at,is_active')
            .order('last_active_at', { ascending: false })
            .limit(5000),
          supabase
            .from('web_user_profiles')
            .select('client_id,telegram_id,nickname,updated_at')
            .order('updated_at', { ascending: false })
            .limit(5000),
        ])

        if (accessResult.error) return res.status(500).json({ error: accessResult.error.message })
        if (tgUsersResult.error) return res.status(500).json({ error: tgUsersResult.error.message })
        if (webProfilesResult.error) return res.status(500).json({ error: webProfilesResult.error.message })

        const accessRows = (accessResult.data || []) as Array<{ chat_id: number; nickname?: string | null; note?: string | null; is_enabled?: boolean | null; is_admin?: boolean | null }>
        const tgRows = (tgUsersResult.data || []) as Array<{ tg_id: number; username?: string | null; first_name?: string | null; last_active_at?: string | null; is_active?: boolean | null }>
        const webRows = (webProfilesResult.data || []) as Array<{ client_id: string; telegram_id?: number | null; nickname?: string | null }>

        const merged = new Map<number, {
          chat_id: number
          telegram_username?: string | null
          telegram_first_name?: string | null
          web_nickname?: string | null
          telegram_is_active?: boolean | null
          last_active_at?: string | null
          is_allowed: boolean
          is_admin: boolean
          access_nickname?: string | null
          access_note?: string | null
          web_client_ids: string[]
        }>()

        for (const row of tgRows) {
          const chatId = toChatId(row.tg_id)
          if (!chatId) continue
          const prev = merged.get(chatId)
          merged.set(chatId, {
            chat_id: chatId,
            telegram_username: row.username || null,
            telegram_first_name: row.first_name || null,
            web_nickname: prev?.web_nickname || null,
            telegram_is_active: row.is_active ?? null,
            last_active_at: row.last_active_at || null,
            is_allowed: prev?.is_allowed || false,
            is_admin: prev?.is_admin || false,
            access_nickname: prev?.access_nickname || null,
            access_note: prev?.access_note || null,
            web_client_ids: prev?.web_client_ids || [],
          })
        }

        for (const row of webRows) {
          const chatId = toChatId(row.telegram_id)
          if (!chatId) continue
          const prev = merged.get(chatId)
          const nextClientIds = prev?.web_client_ids || []
          if (row.client_id && !nextClientIds.includes(String(row.client_id))) {
            nextClientIds.push(String(row.client_id))
          }
          merged.set(chatId, {
            chat_id: chatId,
            telegram_username: prev?.telegram_username || null,
            telegram_first_name: prev?.telegram_first_name || null,
            web_nickname: prev?.web_nickname || row.nickname || null,
            telegram_is_active: prev?.telegram_is_active ?? null,
            last_active_at: prev?.last_active_at || null,
            is_allowed: prev?.is_allowed || false,
            is_admin: prev?.is_admin || false,
            access_nickname: prev?.access_nickname || null,
            access_note: prev?.access_note || null,
            web_client_ids: nextClientIds,
          })
        }

        for (const row of accessRows) {
          const chatId = toChatId(row.chat_id)
          if (!chatId) continue
          const prev = merged.get(chatId)
          merged.set(chatId, {
            chat_id: chatId,
            telegram_username: prev?.telegram_username || null,
            telegram_first_name: prev?.telegram_first_name || null,
            web_nickname: prev?.web_nickname || null,
            telegram_is_active: prev?.telegram_is_active ?? null,
            last_active_at: prev?.last_active_at || null,
            is_allowed: row.is_enabled !== false,
            is_admin: row.is_admin === true,
            access_nickname: row.nickname || prev?.access_nickname || null,
            access_note: row.note || prev?.access_note || null,
            web_client_ids: prev?.web_client_ids || [],
          })
        }

        const mergedRows = Array.from(merged.values())
          .filter((row) => {
            if (!q) return true
            return (
              includesQuery(row.chat_id, q)
              || includesQuery(row.telegram_username, q)
              || includesQuery(row.telegram_first_name, q)
              || includesQuery(row.web_nickname, q)
              || includesQuery(row.access_nickname, q)
              || row.web_client_ids.some((id) => includesQuery(id, q))
            )
          })
          .sort((a, b) => {
            if (a.is_allowed !== b.is_allowed) return a.is_allowed ? -1 : 1
            const ta = new Date(a.last_active_at || '').getTime() || 0
            const tb = new Date(b.last_active_at || '').getTime() || 0
            if (ta !== tb) return tb - ta
            return a.chat_id - b.chat_id
          })
        const total = mergedRows.length
        const totalPages = Math.max(1, Math.ceil(total / pageSize))
        const currentPage = Math.min(page, totalPages)
        const offset = (currentPage - 1) * pageSize

        const rows = mergedRows
          .slice(offset, offset + pageSize)
          .map((row) => ({
            ...row,
            web_client_count: row.web_client_ids.length,
          }))

        const unlinkedWebUsers = webRows
          .filter((row) => !toChatId(row.telegram_id))
          .filter((row) => !q || includesQuery(row.client_id, q) || includesQuery(row.nickname, q))
          .map((row) => ({
            client_id: String(row.client_id),
            nickname: row.nickname || null,
          }))

        return res.status(200).json({
          data: {
            rows,
            unlinked_web_users: unlinkedWebUsers,
            pagination: {
              total,
              page: currentPage,
              page_size: pageSize,
              total_pages: totalPages,
              has_next: currentPage < totalPages,
            },
          },
        })
      }

      const { data, error } = await supabase
        .from(table)
        .select('chat_id,nickname,note,is_enabled,is_admin,updated_by_chat_id,created_at,updated_at')
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
        is_admin: body.is_admin === true,
        updated_by_chat_id: requesterChatId,
      }

      const { data, error } = await supabase
        .from(table)
        .upsert(payload, { onConflict: 'chat_id' })
        .select('chat_id,nickname,note,is_enabled,is_admin,updated_by_chat_id,created_at,updated_at')
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
      if (body.is_admin !== undefined) patch.is_admin = Boolean(body.is_admin)

      const { data, error } = await supabase
        .from(table)
        .update(patch)
        .eq('chat_id', targetChatId)
        .select('chat_id,nickname,note,is_enabled,is_admin,updated_by_chat_id,created_at,updated_at')
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
