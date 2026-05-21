import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

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

      const { data, error } = await supabase
        .from('web_user_profiles')
        .select('client_id,telegram_id,nickname')
        .eq('client_id', clientId)
        .limit(1)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ data: data && data[0] ? data[0] : null })
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

      const payload: any = {
        client_id: clientId,
        telegram_id: telegramId ? Number(telegramId) : null,
        nickname: body.nickname || null,
      }

      const { data, error } = await supabase
        .from('web_user_profiles')
        .upsert(payload, { onConflict: 'client_id' })

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ data: data && data[0] ? data[0] : null })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
