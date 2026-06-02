import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'

type TgProfile = {
  id: number | null
  username: string | null
  first_name: string | null
  last_name: string | null
  type: string | null
  source: 'users' | 'telegram'
}

function normalizeChatId(raw: unknown): string {
  return String(raw ?? '').trim().replace(/[^0-9-]/g, '')
}

function allowedOrigin(origin: string): string {
  const trusted = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    process.env.UI_CORS_ORIGIN ||
    'https://signal-scanner-web.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

  if (origin && trusted.includes(origin)) return origin
  return trusted[0] || '*'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestOrigin = String(req.headers.origin || '').trim()
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin(requestOrigin))
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (denyIfUnauthorizedRead(req, res)) return


  const chatId = normalizeChatId(req.query.chatId)
  if (!chatId) return res.status(400).json({ error: 'chatId required' })

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  const botToken = process.env.TELEGRAM_BOT_TOKEN || ''

  if (supabaseUrl && serviceKey) {
    try {
      const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
      const { data, error } = await supabase
        .from('users')
        .select('tg_id,username,first_name,last_name')
        .eq('tg_id', Number(chatId))
        .single()

      if (!error && data) {
        const out: TgProfile = {
          id: Number(data.tg_id || 0) || null,
          username: data.username || null,
          first_name: data.first_name || null,
          last_name: data.last_name || null,
          type: 'private',
          source: 'users',
        }
        return res.status(200).json(out)
      }
    } catch {
      // continue to telegram fallback
    }
  }

  if (!botToken) {
    return res.status(404).json({ error: 'not_found' })
  }

  try {
    const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getChat?chat_id=${encodeURIComponent(chatId)}`
    const tgRes = await fetch(url)
    const json = await tgRes.json().catch(() => null)
    if (!tgRes.ok || !json?.ok || !json?.result) {
      return res.status(404).json({ error: 'not_found' })
    }

    const chat = json.result
    const out: TgProfile = {
      id: Number(chat.id || 0) || null,
      username: chat.username || null,
      first_name: chat.first_name || null,
      last_name: chat.last_name || null,
      type: chat.type || null,
      source: 'telegram',
    }
    return res.status(200).json(out)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
