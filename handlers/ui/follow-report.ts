import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { setUiCorsHeaders } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { compareFollow, type FollowTrade } from '../../src/services/followReport'

// 따라 샀어요 결산 (src/services/followReport.ts)
// GET: 봇의 최근 체결(따라 할 후보) + 내 실계좌 체결 + 봇 가격 기준 비교
// 실계좌 체결 입력은 기존 /api/ui/virtual-trade(계좌명 지정, memo에 follow:<봇 거래 번호>)를 쓴다.
const WINDOW_DAYS = 90

function toTrade(row: any): FollowTrade {
  return {
    id: String(row.id),
    code: String(row.code),
    name: row.stock?.name ?? null,
    side: row.side === 'SELL' ? 'SELL' : 'BUY',
    price: Number(row.price),
    quantity: Number(row.quantity),
    tradedAt: String(row.traded_at),
    memo: row.memo ?? null,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setUiCorsHeaders(req, res, 'GET,OPTIONS')
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  try {
    const user = await resolveUiUserContext(req)
    if (!user.authenticated) return res.status(401).json({ error: 'Authenticated session required' })
    const owner = [user.clientId ? `client_id.eq.${user.clientId}` : null, user.chatId ? `chat_id.eq.${user.chatId}` : null].filter(Boolean).join(',')
    if (!owner) return res.status(400).json({ error: 'identity required (client_id or chat_id)' })

    const supabase = createClient(url, key, { auth: { persistSession: false } })
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
    const columns = 'id, code, side, price, quantity, traded_at, memo, stock:stocks(name,close)'

    const [botRes, realRes] = await Promise.all([
      supabase.from('virtual_trades').select(columns).or(owner).is('broker_name', null).is('account_name', null).eq('source', 'AUTO').gte('traded_at', since).order('traded_at', { ascending: false }).limit(300),
      supabase.from('virtual_trades').select(columns).or(owner).not('account_name', 'is', null).order('traded_at', { ascending: true }).limit(1000),
    ])
    if (botRes.error) return res.status(500).json({ error: botRes.error.message })
    if (realRes.error) return res.status(500).json({ error: realRes.error.message })

    const bot = (botRes.data ?? []).map(toTrade)
    const real = (realRes.data ?? []).map(toTrade)
    const prices: Record<string, number> = {}
    for (const row of [...(botRes.data ?? []), ...(realRes.data ?? [])] as any[]) {
      const close = Number(row.stock?.close)
      if (close > 0) prices[String(row.code)] = close
    }

    return res.status(200).json({
      ok: true,
      data: {
        windowDays: WINDOW_DAYS,
        bot,
        real,
        prices,
        comparison: compareFollow({ real, bot, prices }),
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
