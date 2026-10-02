import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { mayCreateAccount } from '../../src/services/invites'
import { ensureWebAccountChatId, ensureWebAccountUserRow, isWebOnlyChatId, webAccountIdFor } from '../../src/services/webAccount'

function errorMessage(error: unknown): string {
  return String((error as { message?: string })?.message || error || '')
}

function isMissingTableError(error: unknown, table: string): boolean {
  const msg = errorMessage(error)
  return msg.includes(`Could not find the table 'public.${table}'`)
    || (msg.includes('relation') && msg.includes(table) && msg.includes('does not exist'))
}

function isMissingColumnError(error: unknown, column: string): boolean {
  const msg = errorMessage(error)
  return msg.includes(`column ${column} does not exist`) || (msg.includes('column') && msg.includes(column) && msg.includes('does not exist'))
}

function normalizeTelegramChatId(raw: unknown): string {
  const value = String(raw ?? '').trim().replace(/\s+/g, '')
  if (!value) return ''

  const compact = value.replace(/[^0-9-]/g, '')
  if (!compact) return ''
  if (!/^-?\d+$/.test(compact)) return ''

  return compact
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  const supabase = createClient(url, key)

  try {
    const authHeader = String(req.headers.authorization || '')
    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : ''

    let authenticatedUserId = ''
    if (bearer) {
      const authRes = await fetch(`${url}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: key,
          Authorization: `Bearer ${bearer}`,
        },
      })
      if (!authRes.ok) {
        return res.status(401).json({ error: 'Invalid auth token' })
      }
      const authData = (await authRes.json()) as { id?: string }
      if (!authData?.id) {
        return res.status(401).json({ error: 'Invalid auth token' })
      }
      authenticatedUserId = authData.id
    }

    if (req.method === 'GET') {
      const clientId = authenticatedUserId || String(req.query.client_id || req.query.clientId || '')
      if (!clientId) return res.status(400).json({ error: 'client_id required' })

      let data: Array<Record<string, unknown>> | null = null
      let error: { message?: string } | null = null

      const first = await supabase
        .from('web_user_profiles')
        .select('client_id,telegram_id,nickname')
        .eq('client_id', clientId)
        .limit(1)

      data = first.data as Array<Record<string, unknown>> | null
      error = first.error

      if (error && isMissingColumnError(error, 'nickname')) {
        const fallback = await supabase
          .from('web_user_profiles')
          .select('client_id,telegram_id')
          .eq('client_id', clientId)
          .limit(1)
        data = (fallback.data as Array<Record<string, unknown>> | null)?.map((row) => ({ ...row, nickname: null })) || null
        error = fallback.error
      }

      if (error && isMissingTableError(error, 'web_user_profiles')) {
        return res.status(200).json({ data: null })
      }
      if (error) return res.status(500).json({ error: error.message })
      const row = data && data[0] ? data[0] : null
      // 초대 전용 모드: 아직 회원이 아니면 계정을 만들지 않고 비회원임을 알린다
      if (authenticatedUserId && !row && !(await mayCreateAccount(supabase, clientId))) {
        return res.status(200).json({ data: null, member: false })
      }
      // 텔레그램은 선택 — 로그인한 계정에 연결이 없으면 웹 전용 계정 ID를 만들어 돌려준다
      if (authenticatedUserId && !row?.telegram_id) {
        const chatId = await ensureWebAccountChatId(supabase, clientId)
        return res.status(200).json({
          data: { client_id: clientId, telegram_id: chatId, nickname: row?.nickname ?? null, web_only: true },
        })
      }
      return res.status(200).json({ data: row ? { ...row, web_only: isWebOnlyChatId(row.telegram_id) } : null })
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      const clientId = authenticatedUserId || String(body.client_id || body.clientId || '')
      if (!clientId) return res.status(400).json({ error: 'client_id required' })

      const telegramIdInput = body.telegram_id ?? body.telegramId
      const telegramId = normalizeTelegramChatId(telegramIdInput)
      if (telegramIdInput != null && String(telegramIdInput).trim() !== '' && !telegramId) {
        return res.status(400).json({ error: 'telegram_id must be a numeric Chat ID' })
      }

      if (authenticatedUserId && !(await mayCreateAccount(supabase, clientId))) {
        return res.status(403).json({ error: 'Invite required', member: false })
      }

      // 텔레그램 연결을 비우면 같은 웹 전용 계정 ID로 돌아간다 (로그인 계정마다 고정 값)
      const webChatId = authenticatedUserId ? webAccountIdFor(clientId) : null
      if (webChatId && !telegramId) await ensureWebAccountUserRow(supabase, webChatId)
      const payload: any = {
        client_id: clientId,
        telegram_id: telegramId ? Number(telegramId) : webChatId,
        nickname: body.nickname || null,
      }

      let { data, error } = await supabase
        .from('web_user_profiles')
        .upsert(payload, { onConflict: 'client_id' })

      if (error && isMissingColumnError(error, 'nickname')) {
        const fallbackPayload = {
          client_id: clientId,
          telegram_id: telegramId ? Number(telegramId) : webChatId,
        }
        const fallback = await supabase
          .from('web_user_profiles')
          .upsert(fallbackPayload, { onConflict: 'client_id' })
        data = fallback.data
        error = fallback.error
      }

      if (error && isMissingTableError(error, 'web_user_profiles')) {
        return res.status(200).json({ data: null })
      }

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ data: data && data[0] ? data[0] : null })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
