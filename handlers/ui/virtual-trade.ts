import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,x-user-client-id,Authorization')
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
    const user = await resolveUiUserContext(req)
    const filterColumn = user.clientId ? 'client_id' : (user.chatId ? 'chat_id' : null)
    const filterValue = user.clientId || user.chatId || null
    if (!filterColumn || !filterValue) return res.status(400).json({ error: 'identity required (client_id or chat_id)' })

    let brokerName = String(broker_name || '').trim() || null
    let accountName = String(account_name || '').trim() || null
    if (!brokerName && !accountName) {
      const { data: posRows } = await supabase
        .from('virtual_positions')
        .select('broker_name,account_name,quantity,status,id')
        .eq(filterColumn, filterValue)
        .eq('code', String(code))
        .order('quantity', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
      const pos = Array.isArray(posRows) && posRows.length > 0 ? posRows[0] : null
      brokerName = String((pos as any)?.broker_name || '').trim() || null
      accountName = String((pos as any)?.account_name || '').trim() || null
    }

    const insertResp = await supabase.from('virtual_trades').insert([{ 
      chat_id: user.chatId ?? null,
      client_id: user.clientId ?? null,
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

    const tradeSide = String(trade.side || '').toUpperCase()
    const codeText = String(trade.code || '').trim().toUpperCase()

    const applyAccountScope = <T extends { eq: Function; is: Function }>(query: T) => {
      let scoped: any = query
      if (brokerName) scoped = scoped.eq('broker_name', brokerName)
      else scoped = scoped.is('broker_name', null)
      if (accountName) scoped = scoped.eq('account_name', accountName)
      else scoped = scoped.is('account_name', null)
      return scoped
    }

    // Keep virtual_positions in sync so UI reflects quantity/avg immediately after BUY.
    if (tradeSide === 'BUY') {
      let positionRow: any = null
      const positionSelectBase = supabase
        .from('virtual_positions')
        .select('id, quantity, invested_amount, buy_price, buy_date, broker_name, account_name')
        .eq(filterColumn, filterValue)
        .eq('code', codeText)
      const positionSelect = applyAccountScope(positionSelectBase)
      const { data: existingRows, error: posErr } = await positionSelect.order('id', { ascending: false }).limit(1)
      if (posErr) return res.status(500).json({ error: String(posErr.message || posErr) })
      positionRow = Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null

      const prevQty = Math.max(0, Number(positionRow?.quantity || 0))
      const prevInvestedRaw = Number(positionRow?.invested_amount)
      const prevInvested = Number.isFinite(prevInvestedRaw)
        ? prevInvestedRaw
        : (prevQty * Math.max(0, Number(positionRow?.buy_price || 0)))
      const nextQty = prevQty + qty
      const nextInvested = prevInvested + gross
      const nextAvg = nextQty > 0 ? (nextInvested / nextQty) : pr
      const defaultBuyDate = new Date().toISOString().slice(0, 10)

      if (positionRow?.id) {
        const { error: upErr } = await supabase
          .from('virtual_positions')
          .update({
            quantity: nextQty,
            invested_amount: nextInvested,
            buy_price: nextAvg,
            status: 'holding',
            buy_date: String(positionRow?.buy_date || defaultBuyDate),
            broker_name: brokerName || positionRow?.broker_name || null,
            account_name: accountName || positionRow?.account_name || null,
          })
          .eq('id', positionRow.id)
        if (upErr) return res.status(500).json({ error: String(upErr.message || upErr) })
      } else {
        const { data: insertedPos, error: insErr } = await supabase
          .from('virtual_positions')
          .insert([{
            chat_id: user.chatId ?? null,
            client_id: user.clientId ?? null,
            code: codeText,
            quantity: qty,
            invested_amount: gross,
            buy_price: pr,
            status: 'holding',
            buy_date: defaultBuyDate,
            broker_name: brokerName,
            account_name: accountName,
          }])
          .select('id')
          .single()
        if (insErr) return res.status(500).json({ error: String(insErr.message || insErr) })
        positionRow = insertedPos
      }

      const { error: lotInsertErr } = await supabase.from('virtual_trade_lots').insert([{
        chat_id: user.chatId ?? null,
        client_id: user.clientId ?? null,
        code: codeText,
        position_id: positionRow?.id || null,
        acquired_price: pr,
        acquired_quantity: qty,
        remaining_quantity: qty,
        acquired_at: new Date().toISOString(),
      }])
      if (lotInsertErr) return res.status(500).json({ error: String(lotInsertErr.message || lotInsertErr) })
    }

    // If SELL, match against virtual_trade_lots FIFO and record lot matches
    if (tradeSide === 'SELL') {
      try {
        let remaining = Number(trade.quantity || 0)
        let realized = 0

        let scopedPositionIds: Array<number | string> = []
        const scopedPosQueryBase = supabase
          .from('virtual_positions')
          .select('id')
          .eq(filterColumn, filterValue)
          .eq('code', codeText)
        const scopedPosQuery = applyAccountScope(scopedPosQueryBase)
        const { data: scopedPosRows } = await scopedPosQuery.limit(200)
        scopedPositionIds = (scopedPosRows || []).map((r: any) => r.id).filter(Boolean)

        let lotsQuery = supabase
          .from('virtual_trade_lots')
          .select('id, position_id, acquired_price, remaining_quantity')
          .eq(filterColumn, filterValue)
          .eq('code', codeText)
          .gt('remaining_quantity', 0)
        let lots: any[] = []
        if (scopedPositionIds.length > 0) {
          const { data } = await lotsQuery.in('position_id', scopedPositionIds).order('acquired_at', { ascending: true }).limit(200)
          lots = data || []
        }

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
              chat_id: user.chatId ?? null,
              client_id: user.clientId ?? null,
              code: codeText,
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
                  await supabase
                    .from('virtual_positions')
                    .update({
                      quantity: newQty,
                      invested_amount: newInvested,
                      status: newQty > 0 ? 'holding' : 'interest',
                    })
                    .eq('id', pos.id)
                }
              } catch (e) {
                // ignore per-lot position update errors
              }
            }

            remaining -= take
          }
        }

        // Fallback for legacy rows without lots: still reduce virtual_positions quantity/invested_amount.
        if (remaining > 0) {
          const posQueryBase = supabase
            .from('virtual_positions')
            .select('id, quantity, invested_amount, buy_price')
            .eq(filterColumn, filterValue)
            .eq('code', codeText)
          const posQuery = applyAccountScope(posQueryBase)
          const { data: posRows } = await posQuery.order('id', { ascending: false }).limit(1)
          const pos = Array.isArray(posRows) && posRows.length > 0 ? posRows[0] : null
          if (pos) {
            const posQty = Math.max(0, Number(pos.quantity || 0))
            const take = Math.min(posQty, remaining)
            if (take > 0) {
              const invested = Number.isFinite(Number(pos.invested_amount))
                ? Number(pos.invested_amount)
                : posQty * Math.max(0, Number(pos.buy_price || 0))
              const unitCost = posQty > 0 ? (invested / posQty) : Math.max(0, Number(pos.buy_price || 0))
              const costAmt = unitCost * take
              realized += (pr - unitCost) * take
              const nextQty = posQty - take
              const nextInvested = Math.max(0, invested - costAmt)
              await supabase
                .from('virtual_positions')
                .update({
                  quantity: nextQty,
                  invested_amount: nextInvested,
                  status: nextQty > 0 ? 'holding' : 'interest',
                })
                .eq('id', pos.id)
              remaining -= take
            }
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
