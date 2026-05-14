import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from '../../handlers/ui/_userContext'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

// 간단한 현재가 캐시 (실제로는 pykrx나 외부 API 사용)
const priceCache = new Map<string, { price: number; timestamp: number }>()
const CACHE_TTL = 60000 // 60초

async function getCurrentPrice(code: string): Promise<number | null> {
  // 캐시 확인
  const cached = priceCache.get(code)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.price
  }

  try {
    // TODO: 실제 현재가 조회 (pykrx, 증권사 API 등)
    // 임시: 마지막 매수/매도 가격으로 사용
    return null
  } catch (e) {
    console.error(`Failed to get price for ${code}:`, e)
    return null
  }
}

async function setCurrentPrice(code: string, price: number) {
  priceCache.set(code, { price, timestamp: Date.now() })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

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

  try {
    // 1) 활성 포지션 조회
    const { data: positions, error: posErr } = await supabase
      .from('virtual_positions')
      .select('*')
      .eq('chat_id', chatId)
      .gt('quantity', 0)

    if (posErr) throw posErr

    if (!Array.isArray(positions) || positions.length === 0) {
      return res.status(200).json({
        ok: true,
        data: {
          total_invested: 0,
          total_current_value: 0,
          total_pnl: 0,
          total_pnl_percent: 0,
          positions: [],
          last_updated: new Date().toISOString(),
        },
      })
    }

    // 2) 현재가 조회 (DB 또는 캐시)
    const positionsWithPrice: any[] = []
    let totalInvested = 0
    let totalCurrentValue = 0

    for (const pos of positions) {
      const invested = Number(pos.invested_amount || 0)
      totalInvested += invested

      // 현재가 조회
      // 주의: 실제로는 pykrx, 증권사 API, 또는 stocks 테이블에서 조회
      // 임시: 마지막 매매 가격 조회
      const { data: lastTrade } = await supabase
        .from('virtual_trades')
        .select('price')
        .eq('chat_id', chatId)
        .eq('code', String(pos.code))
        .order('id', { ascending: false })
        .limit(1)
        .single()

      const currentPrice = lastTrade?.price ? Number(lastTrade.price) : Number(pos.buy_price || 0)
      const currentValue = Number(pos.quantity || 0) * currentPrice
      totalCurrentValue += currentValue

      const pnlAmount = currentValue - invested
      const pnlPercent = invested > 0 ? (pnlAmount / invested) * 100 : 0

      positionsWithPrice.push({
        id: pos.id,
        code: pos.code,
        quantity: pos.quantity,
        buy_price: pos.buy_price,
        invested_amount: invested,
        current_price: currentPrice,
        current_value: currentValue,
        pnl_amount: pnlAmount,
        pnl_percent: pnlPercent,
        stop_loss_percent: pos.stop_loss_percent,
        take_profit_targets: pos.take_profit_targets,
        auto_trading_enabled: pos.auto_trading_enabled,
        status: pos.status,
      })
    }

    const totalPnL = totalCurrentValue - totalInvested
    const totalPnLPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0

    return res.status(200).json({
      ok: true,
      data: {
        total_invested: totalInvested,
        total_current_value: totalCurrentValue,
        total_pnl: totalPnL,
        total_pnl_percent: totalPnLPercent,
        positions: positionsWithPrice,
        last_updated: new Date().toISOString(),
      },
    })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
}
