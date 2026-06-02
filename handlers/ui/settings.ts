import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'

function toPositiveInt(raw: unknown): number | null {
  const num = Number(String(raw ?? '').trim())
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.trunc(num)
}

function resolveTargetChatId(req: VercelRequest, userChatId: number | null): number | null {
  const body = (req.body || {}) as any
  return (
    userChatId
    || toPositiveInt(req.headers['x-user-chat-id'])
    || toPositiveInt(req.query.chat_id)
    || toPositiveInt(req.query.chatId)
    || toPositiveInt(body.chat_id)
    || toPositiveInt(body.chatId)
    || null
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,x-user-client-id,Authorization')
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
    const user = await resolveUiUserContext(req)
    const targetChatId = resolveTargetChatId(req, user.chatId)

    if (req.method === 'GET') {
      if (!targetChatId) return res.status(200).json({ data: null })
      const { data, error } = await supabase
        .from('virtual_autotrade_settings')
        .select('*')
        .eq('chat_id', targetChatId)
        .limit(1)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ data: data && data[0] ? data[0] : null })
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      if (!targetChatId) return res.status(400).json({ error: 'chat_id required' })

      const VALID_STRATEGIES = ['HOLD_SAFE', 'REDUCE_TIGHT', 'WAIT_AND_DIP_BUY']
      const rawStrategy = String(body.selected_strategy || '').trim().toUpperCase()

      const payload: any = {
        chat_id: targetChatId,
        is_enabled: body.is_enabled === true || body.is_enabled === 'true' || false,
        monday_buy_slots: body.monday_buy_slots != null ? Number(body.monday_buy_slots) : undefined,
        max_positions: body.max_positions != null ? Number(body.max_positions) : undefined,
        min_buy_score: body.min_buy_score != null ? Number(body.min_buy_score) : undefined,
        take_profit_pct: body.take_profit_pct != null ? Number(body.take_profit_pct) : undefined,
        stop_loss_pct: body.stop_loss_pct != null ? Number(body.stop_loss_pct) : undefined,
        long_term_ratio: body.long_term_ratio != null ? Number(body.long_term_ratio) : undefined,
        selected_strategy: VALID_STRATEGIES.includes(rawStrategy) ? rawStrategy : undefined,
      }

      const { error: upsertError } = await supabase
        .from('virtual_autotrade_settings')
        .upsert(payload, { onConflict: 'chat_id' })

      if (upsertError) return res.status(500).json({ error: upsertError.message })

      const { data, error } = await supabase
        .from('virtual_autotrade_settings')
        .select('*')
        .eq('chat_id', targetChatId)
        .maybeSingle()

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ data: data ?? null })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
