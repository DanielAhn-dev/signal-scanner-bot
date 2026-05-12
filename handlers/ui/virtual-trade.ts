import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  const { code, side, quantity, price, memo, broker_name, account_name } = req.body || {}
  if (!code || !side || !quantity || !price) return res.status(400).json({ error: 'Missing fields' })

  const supabase = createClient(url, key)

  try {
    const qty = Number(quantity)
    const pr = Number(price)
    const gross = qty * pr
    const user = resolveUiUserContext(req)
    const chatId = user.chatId
    if (!chatId) return res.status(400).json({ error: 'chat_id required (header x-user-chat-id, query/body chat_id, or server default)' })

    let brokerName = String(broker_name || '').trim() || null
    let accountName = String(account_name || '').trim() || null
    if (!brokerName && !accountName) {
      const { data: pos } = await supabase
        .from('virtual_positions')
        .select('broker_name,account_name')
        .eq('chat_id', chatId)
        .eq('code', String(code))
        .maybeSingle()
      brokerName = String((pos as any)?.broker_name || '').trim() || null
      accountName = String((pos as any)?.account_name || '').trim() || null
    }

    const insertResp = await supabase.from('virtual_trades').insert([{ 
      chat_id: chatId,
      code: String(code),
      side: String(side).toUpperCase(),
      price: pr,
      quantity: qty,
      gross_amount: gross,
      net_amount: gross,
      fee_amount: 0,
      tax_amount: 0,
      broker_name: brokerName,
      account_name: accountName,
      memo: memo || null,
    }]).select().single()

    if (insertResp.error) return res.status(500).json({ error: String(insertResp.error) })

    const trade = insertResp.data

    // If SELL, match against virtual_trade_lots FIFO and record lot matches
    if (String(trade.side).toUpperCase() === 'SELL') {
      try {
        let remaining = Number(trade.quantity || 0)
        let realized = 0

        const { data: lots } = await supabase
          .from('virtual_trade_lots')
          .select('id, position_id, acquired_price, remaining_quantity')
          .eq('chat_id', chatId)
          .eq('code', trade.code)
          .gt('remaining_quantity', 0)
          .order('acquired_at', { ascending: true })
          .limit(200)

        if (lots && lots.length) {
          for (const lot of lots) {
            if (remaining <= 0) break
            const lotRem = Number(lot.remaining_quantity || 0)
            if (lotRem <= 0) continue
            const take = Math.min(remaining, lotRem)
            const unitCost = Number(lot.acquired_price || 0)
            const costAmt = unitCost * take
            const pnlPiece = (pr - unitCost) * take
            realized += pnlPiece

            // insert lot match
            await supabase.from('virtual_trade_lot_matches').insert([{
              trade_id: trade.id,
              lot_id: lot.id,
              chat_id: chatId,
              code: trade.code,
              quantity: take,
              unit_cost: unitCost,
              cost_amount: costAmt,
              pnl_amount: pnlPiece,
            }])

            // decrement lot remaining_quantity
            const newRem = lotRem - take
            const upd: any = { remaining_quantity: newRem }
            if (newRem <= 0) upd.closed_at = new Date().toISOString()
            await supabase.from('virtual_trade_lots').update(upd).eq('id', lot.id)

            // if linked to a position, decrement that position's quantity/invested_amount
            if (lot.position_id) {
              try {
                const { data: pos } = await supabase.from('virtual_positions').select('id, quantity, invested_amount').eq('id', lot.position_id).single()
                if (pos) {
                  const newQty = Math.max(0, Number(pos.quantity || 0) - take)
                  const newInvested = pos.invested_amount != null ? Number(pos.invested_amount) - costAmt : null
                  await supabase.from('virtual_positions').update({ quantity: newQty, invested_amount: newInvested }).eq('id', pos.id)
                }
              } catch (e) {
                // ignore per-lot position update errors
              }
            }

            remaining -= take
          }
        }

        // update trade with realized pnl
        await supabase.from('virtual_trades').update({ pnl_amount: realized }).eq('id', trade.id)
      } catch (e) {
        console.warn('SELL lot matching warning:', e)
      }
    }

    return res.status(200).json({ ok: true, trade: insertResp.data })
  } catch (e:any) {
    return res.status(500).json({ error: String(e) })
  }
}
