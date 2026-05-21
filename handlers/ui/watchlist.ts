import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) throw new Error('Server not configured')
  _supabase = createClient(url, key, { auth: { persistSession: false } })
  return _supabase
}

function normalizeCode(input: unknown): string {
  return String(input || '').trim().toUpperCase()
}

type WatchlistPositionRow = {
  code?: string | null
  buy_price?: number | null
  buy_date?: string | null
  created_at?: string | null
  memo?: string | null
  quantity?: number | null
  stock?: {
    name?: string | null
    close?: number | null
  } | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!['GET', 'POST', 'DELETE'].includes(String(req.method || ''))) {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  const user = await resolveUiUserContext(req)
  const chatId = user.chatId
  if (!chatId) return res.status(400).json({ error: 'chat_id required (header x-user-chat-id, query/body chat_id, or server default)' })

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('virtual_positions')
        .select('code, buy_price, buy_date, created_at, memo, quantity, stock:stocks(name, close)')
        .eq('chat_id', chatId)
        .eq('status', 'interest')
        .order('created_at', { ascending: false })

      if (error) return res.status(500).json({ error: error.message })

      const items = (Array.isArray(data) ? data : []).map((row) => {
        const r = row as unknown as WatchlistPositionRow
        return {
          stock_code: String(r.code || ''),
          stock_name: String(r.stock?.name || r.code || ''),
          buy_price: r.buy_price == null ? null : Number(r.buy_price),
          current_price: r.stock?.close == null ? null : Number(r.stock.close),
          change_rate: null,
          buy_date: r.buy_date || null,
          created_at: r.created_at || null,
          memo: r.memo || null,
        }
      })

      return res.status(200).json({ ok: true, data: { items } })
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      const code = normalizeCode((body as any).code || (body as any).stock_code)
      if (!code) return res.status(400).json({ error: 'code is required' })

      const { data: stock, error: stockErr } = await supabase
        .from('stocks')
        .select('code, close')
        .eq('code', code)
        .maybeSingle()
      if (stockErr) return res.status(500).json({ error: stockErr.message })
      if (!stock) return res.status(404).json({ error: '종목을 찾을 수 없습니다.' })

      const { data: existing, error: exErr } = await supabase
        .from('virtual_positions')
        .select('id, code, status, quantity, invested_amount')
        .eq('chat_id', chatId)
        .eq('code', code)
        .maybeSingle()
      if (exErr) return res.status(500).json({ error: exErr.message })

      if (existing) {
        if (Number(existing.quantity || 0) > 0) {
          return res.status(200).json({ ok: true, alreadyHolding: true, data: existing })
        }

        const { data: updated, error: upErr } = await supabase
          .from('virtual_positions')
          .update({
            status: 'interest',
            quantity: 0,
            invested_amount: 0,
          })
          .eq('id', existing.id)
          .select('id, code, status, quantity, invested_amount')
          .single()
        if (upErr) return res.status(500).json({ error: upErr.message })

        return res.status(200).json({ ok: true, upserted: true, data: updated })
      }

      const close = stock.close != null ? Number(stock.close) : null
      const today = new Date().toISOString().slice(0, 10)
      const { data: inserted, error: insErr } = await supabase
        .from('virtual_positions')
        .insert([{
          chat_id: chatId,
          code,
          buy_price: close,
          buy_date: today,
          quantity: 0,
          invested_amount: 0,
          status: 'interest',
        }])
        .select('id, code, status, quantity, invested_amount')
        .single()
      if (insErr) return res.status(500).json({ error: insErr.message })

      return res.status(200).json({ ok: true, inserted: true, data: inserted })
    }

    const code = normalizeCode((req.body || {}).code || req.query.code)
    if (!code) return res.status(400).json({ error: 'code is required' })

    const { data: existing, error: exErr } = await supabase
      .from('virtual_positions')
      .select('id, code, status, quantity')
      .eq('chat_id', chatId)
      .eq('code', code)
      .maybeSingle()
    if (exErr) return res.status(500).json({ error: exErr.message })

    if (!existing) return res.status(200).json({ ok: true, removed: false })

    if (Number(existing.quantity || 0) > 0 && String(existing.status || '').toLowerCase() !== 'interest') {
      return res.status(409).json({ error: '보유 종목은 포트폴리오에서 매도 후 삭제하세요.' })
    }

    const { error: delErr } = await supabase.from('virtual_positions').delete().eq('id', existing.id)
    if (delErr) return res.status(500).json({ error: delErr.message })

    return res.status(200).json({ ok: true, removed: true })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
