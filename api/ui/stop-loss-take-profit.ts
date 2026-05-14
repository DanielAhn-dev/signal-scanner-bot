import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from '../../handlers/ui/_userContext'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
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
  const user = resolveUiUserContext(req)
  const chatId = user.chatId

  if (!chatId) {
    return res.status(400).json({ error: 'chat_id required' })
  }

  if (req.method === 'POST') {
    // POST: 손절/익절 규칙 저장
    const { code, stop_loss_percent, take_profit_targets, auto_trading_enabled } = req.body || {}

    if (!code) {
      return res.status(400).json({ error: 'code required' })
    }

    try {
      const updateData: Record<string, any> = {}

      if (stop_loss_percent !== undefined) {
        updateData.stop_loss_percent = stop_loss_percent
      }

      if (take_profit_targets !== undefined) {
        updateData.take_profit_targets = take_profit_targets
      }

      if (auto_trading_enabled !== undefined) {
        updateData.auto_trading_enabled = auto_trading_enabled
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No fields to update' })
      }

      const { data, error } = await supabase
        .from('virtual_positions')
        .update(updateData)
        .eq('chat_id', chatId)
        .eq('code', String(code).toUpperCase())
        .select()
        .single()

      if (error) {
        return res.status(400).json({ error: String(error.message || error) })
      }

      return res.status(200).json({ ok: true, data })
    } catch (e) {
      return res.status(500).json({ error: String(e) })
    }
  }

  if (req.method === 'GET') {
    // GET: 손절/익절 설정 조회
    const code = req.query.code ? String(req.query.code).toUpperCase() : undefined

    try {
      let query = supabase
        .from('virtual_positions')
        .select('id,code,quantity,buy_price,status,stop_loss_percent,take_profit_targets,auto_trading_enabled')
        .eq('chat_id', chatId)

      if (code) {
        query = query.eq('code', code)
      }

      const { data, error } = await query

      if (error) {
        return res.status(400).json({ error: String(error.message || error) })
      }

      return res.status(200).json({ ok: true, positions: data })
    } catch (e) {
      return res.status(500).json({ error: String(e) })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
