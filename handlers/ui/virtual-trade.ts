import { toKstDateKey } from '../../src/lib/krxCalendar'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { setUiCorsHeaders } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { resolveBaseSellTaxRate, resolveSellTaxRate } from '../../src/lib/securitiesTax'
import { getUserInvestmentPrefs } from '../../src/services/userService'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setUiCorsHeaders(req, res, 'GET,POST,OPTIONS')
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

  try {
    const qty = Number(quantity)
    const pr = Number(price)
    const sideUpper = String(side).trim().toUpperCase()
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive integer' })
    }
    if (!Number.isFinite(pr) || pr <= 0) {
      return res.status(400).json({ error: 'price must be a positive number' })
    }
    if (sideUpper !== 'BUY' && sideUpper !== 'SELL') {
      return res.status(400).json({ error: 'side must be BUY or SELL' })
    }

    const supabase = createClient(url, key)
    const user = await resolveUiUserContext(req)
    if (!user.authenticated) return res.status(401).json({ error: 'Authenticated session required' })

    const filterColumn = user.clientId ? 'client_id' : (user.chatId ? 'chat_id' : null)
    const filterValue = user.clientId || user.chatId || null
    if (!filterColumn || !filterValue) return res.status(400).json({ error: 'identity required (client_id or chat_id)' })

    let brokerName = String(broker_name || '').trim() || null
    let accountName = String(account_name || '').trim() || null
    if (!brokerName && !accountName) {
      const { data: posRows, error: posErr } = await supabase
        .from('virtual_positions')
        .select('broker_name,account_name,quantity,status,id')
        .eq(filterColumn, filterValue)
        .eq('code', String(code))
        .order('quantity', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
      if (posErr) return res.status(500).json({ error: posErr.message })
      const pos = Array.isArray(posRows) && posRows.length > 0 ? posRows[0] : null
      brokerName = String((pos as any)?.broker_name || '').trim() || null
      accountName = String((pos as any)?.account_name || '').trim() || null
    }

    const isBotAccount = !brokerName && !accountName
    const prefs = user.chatId ? await getUserInvestmentPrefs(user.chatId) : {}
    const feeRate = Number.isFinite(Number(prefs.virtual_fee_rate)) && Number(prefs.virtual_fee_rate) >= 0
      ? Number(prefs.virtual_fee_rate)
      : 0.00015
    const gross = qty * pr
    const feeAmount = Math.round(gross * feeRate)
    let taxAmount = 0
    let netAmount = gross + feeAmount
    if (sideUpper === 'SELL') {
      const { data: stockRow, error: stockErr } = await supabase
        .from('stocks')
        .select('name')
        .eq('code', String(code))
        .maybeSingle()
      if (stockErr) return res.status(500).json({ error: stockErr.message })
      const baseTaxRate = resolveBaseSellTaxRate(prefs.virtual_tax_rate)
      const taxRate = resolveSellTaxRate({ code: String(code), name: (stockRow as any)?.name ?? null, baseRate: baseTaxRate })
      taxAmount = Math.round(gross * taxRate)
      netAmount = Math.max(0, gross - feeAmount - taxAmount)
    }

    const { data: trade, error: tradeErr } = await supabase.rpc('execute_virtual_trade', {
      p_client_id: user.clientId,
      p_chat_id: user.chatId,
      p_code: String(code),
      p_side: sideUpper,
      p_quantity: qty,
      p_price: pr,
      p_gross: gross,
      p_net: netAmount,
      p_fee: feeAmount,
      p_tax: taxAmount,
      p_broker_name: brokerName,
      p_account_name: accountName,
      p_buy_date: toKstDateKey(),
      p_memo: memo || null,
      p_is_bot_account: isBotAccount,
      p_cash_before: Number(prefs.virtual_cash) || 0,
      p_realized_before: Number(prefs.virtual_realized_pnl) || 0,
    })

    if (tradeErr) return res.status(500).json({ error: tradeErr.message })
    return res.status(200).json({ ok: true, trade })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
