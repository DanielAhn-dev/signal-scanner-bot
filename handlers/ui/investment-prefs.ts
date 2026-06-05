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
        .from('users')
        .select('prefs')
        .eq('tg_id', targetChatId)
        .maybeSingle()

      if (error) return res.status(500).json({ error: error.message })

      const prefs = (data?.prefs || {}) as Record<string, unknown>
      const virtualSeedCapital = Number(prefs.virtual_seed_capital)
      const rawCash = prefs.virtual_cash
      const virtualCash = rawCash != null ? Number(rawCash) : null
      const capitalKrw = Number(prefs.capital_krw)

      return res.status(200).json({
        data: {
          virtual_seed_capital: Number.isFinite(virtualSeedCapital) && virtualSeedCapital > 0 ? virtualSeedCapital : null,
          virtual_cash: virtualCash != null && Number.isFinite(virtualCash) && virtualCash >= 0 ? virtualCash : null,
          capital_krw: Number.isFinite(capitalKrw) && capitalKrw > 0 ? capitalKrw : null,
        }
      })
    }

    if (req.method === 'POST') {
      if (!targetChatId) return res.status(400).json({ error: 'chat_id required' })

      const body = req.body || {}
      const newSeedCapital = toPositiveInt(body.virtual_seed_capital)
      const resetCash = body.reset_cash === true || body.reset_cash === 'true'

      if (newSeedCapital === null) {
        return res.status(400).json({ error: 'virtual_seed_capital must be a positive integer' })
      }

      // Merge into existing prefs
      const { data: userRow } = await supabase
        .from('users')
        .select('prefs')
        .eq('tg_id', targetChatId)
        .maybeSingle()

      const currentPrefs = ((userRow?.prefs as Record<string, unknown>) || {}) as Record<string, unknown>
      const updatedPrefs: Record<string, unknown> = {
        ...currentPrefs,
        virtual_seed_capital: newSeedCapital,
      }

      if (resetCash) {
        updatedPrefs.virtual_cash = newSeedCapital
      }

      const { error: upsertError } = await supabase
        .from('users')
        .update({ prefs: updatedPrefs })
        .eq('tg_id', targetChatId)

      if (upsertError) return res.status(500).json({ error: upsertError.message })

      const virtualCashFinal = Number(updatedPrefs.virtual_cash)
      return res.status(200).json({
        data: {
          virtual_seed_capital: newSeedCapital,
          virtual_cash: Number.isFinite(virtualCashFinal) && virtualCashFinal >= 0 ? virtualCashFinal : null,
        }
      })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
