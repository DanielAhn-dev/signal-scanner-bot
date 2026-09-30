import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { setUiCorsHeaders } from './_accessControl'
import { resolveUiUserContext } from './_userContext'

function resolveTargetChatId(userChatId: number | null): number | null {
  // 인증된 세션의 chatId만 신뢰한다. 요청이 넘기는 chat_id는 사용하지 않는다.
  return userChatId
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setUiCorsHeaders(req, res, 'GET,POST,OPTIONS')
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
    if (!user.authenticated) return res.status(401).json({ error: 'Authenticated session required' })
    const targetChatId = resolveTargetChatId(user.chatId)

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

      // 활성화는 시드를 정한 뒤에만 — 내가 감당할 수 있는 금액을 먼저 정하고 시작한다
      if (body.is_enabled === true || body.is_enabled === 'true') {
        const { data: userRow } = await supabase.from('users').select('prefs').eq('tg_id', targetChatId).maybeSingle()
        const prefs = ((userRow?.prefs as Record<string, unknown>) || {}) as Record<string, unknown>
        if (!(Number(prefs.virtual_seed_capital) > 0) || prefs.virtual_cash == null) {
          return res.status(400).json({ error: '시드(시작 금액)를 먼저 저장한 뒤 활성화하세요' })
        }
      }

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
