import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'

function toNumberOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeLabel(value: unknown): string {
  return String(value || '').trim()
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
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

  try {
    const user = await resolveUiUserContext(req)
    const chatId = user.chatId
    if (!chatId) return res.status(400).json({ error: 'chat_id required' })

    if (req.method === 'GET') {
      const brokerName = normalizeLabel(req.query.broker_name)
      const accountName = normalizeLabel(req.query.account_name)

      let query = supabase
        .from('virtual_account_policies')
        .select('*')
        .eq('chat_id', Number(chatId))
        .order('updated_at', { ascending: false })

      if (brokerName) query = query.eq('broker_name', brokerName)
      if (accountName) query = query.eq('account_name', accountName)

      const { data, error } = await query
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ data: data ?? [] })
    }

    if (req.method === 'POST') {
      const body = (req.body || {}) as any
      const brokerName = normalizeLabel(body.broker_name)
      const accountName = normalizeLabel(body.account_name)
      if (!brokerName || !accountName) {
        return res.status(400).json({ error: 'broker_name and account_name are required' })
      }

      const riskProfileRaw = normalizeLabel(body.risk_profile).toLowerCase()
      const riskProfile = ['safe', 'balanced', 'active'].includes(riskProfileRaw)
        ? riskProfileRaw
        : 'balanced'

      const payload: any = {
        chat_id: Number(chatId),
        broker_name: brokerName,
        account_name: accountName,
        risk_profile: riskProfile,
        max_positions: toNumberOrNull(body.max_positions),
        daily_loss_limit_pct: toNumberOrNull(body.daily_loss_limit_pct),
        min_cash_reserve_pct: toNumberOrNull(body.min_cash_reserve_pct),
        add_entry_score_adjust: Math.round(toNumberOrNull(body.add_entry_score_adjust) ?? 0),
        partial_take_profit_adjust_pct: toNumberOrNull(body.partial_take_profit_adjust_pct) ?? 0,
        stop_loss_pct: toNumberOrNull(body.stop_loss_pct),
        take_profit_pct: toNumberOrNull(body.take_profit_pct),
        updated_at: new Date().toISOString(),
      }

      const { data, error } = await supabase
        .from('virtual_account_policies')
        .upsert(payload, { onConflict: 'chat_id,broker_name,account_name' })
        .select('*')
        .single()

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ data })
    }

    if (req.method === 'DELETE') {
      const body = (req.body || {}) as any
      const brokerName = normalizeLabel(body.broker_name)
      const accountName = normalizeLabel(body.account_name)
      if (!brokerName || !accountName) {
        return res.status(400).json({ error: 'broker_name and account_name are required' })
      }

      const { error } = await supabase
        .from('virtual_account_policies')
        .delete()
        .eq('chat_id', Number(chatId))
        .eq('broker_name', brokerName)
        .eq('account_name', accountName)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
