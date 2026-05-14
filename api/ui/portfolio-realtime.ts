import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from '../../handlers/ui/_userContext'
import { fetchRealtimePriceBatch, type RealtimeStockData } from '../../src/utils/fetchRealtimePrice'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

const REALTIME_BATCH_TOTAL_TIMEOUT_MS = Math.max(1000, Number(process.env.UI_REALTIME_BATCH_TIMEOUT_MS || 4000))

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

    // 2) 실시간 현재가 배치 조회
    const codes = positions
      .map((pos) => String(pos?.code || '').trim())
      .filter(Boolean)
    const realtimePriceMap = codes.length > 0
      ? await Promise.race([
          fetchRealtimePriceBatch(codes),
          new Promise<Record<string, RealtimeStockData>>((resolve) =>
            setTimeout(() => resolve({}), REALTIME_BATCH_TOTAL_TIMEOUT_MS),
          ),
        ]).catch(() => ({} as Record<string, RealtimeStockData>))
      : {}

    // 3) 포지션별 현재가 및 손익 계산
    const positionsWithPrice: any[] = []
    let totalInvested = 0
    let totalCurrentValue = 0

    for (const pos of positions) {
      const invested = Number(pos.invested_amount || 0)
      totalInvested += invested

      const code = String(pos.code || '').trim()
      const realtimePrice = Number(realtimePriceMap[code]?.price)
      const hasRealtime = Number.isFinite(realtimePrice) && realtimePrice > 0
      let currentPrice = hasRealtime ? realtimePrice : Number(pos.buy_price || 0)

      if (!hasRealtime) {
        // 실시간 조회 실패 시 마지막 체결가로 보강
        const { data: lastTrade } = await supabase
          .from('virtual_trades')
          .select('price')
          .eq('chat_id', chatId)
          .eq('code', code)
          .order('id', { ascending: false })
          .limit(1)
          .single()
        const fallbackTradePrice = Number(lastTrade?.price)
        if (Number.isFinite(fallbackTradePrice) && fallbackTradePrice > 0) {
          currentPrice = fallbackTradePrice
        }
      }

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
