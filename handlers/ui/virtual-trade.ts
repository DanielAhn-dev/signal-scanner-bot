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

  const { code, side, quantity, price, memo, broker_name, account_name, trade_date } = req.body || {}
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

    // 체결일(KST): 비우면 오늘. 과거 날짜는 실계좌 매수만, 최근 7일까지(DB 함수가 다시 확인한다)
    const todayKey = toKstDateKey()
    const tradeDate = trade_date == null || String(trade_date).trim() === '' ? todayKey : String(trade_date).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return res.status(400).json({ error: 'trade_date must be YYYY-MM-DD' })
    if (tradeDate > todayKey) return res.status(400).json({ error: '체결일은 오늘 이후일 수 없습니다' })
    const isBackdated = tradeDate < todayKey
    if (isBackdated && sideUpper !== 'BUY') return res.status(400).json({ error: '지난 날짜 기록은 매수만 가능합니다' })
    if (isBackdated && tradeDate < toKstDateKey(new Date(Date.now() - 7 * 86_400_000))) {
      return res.status(400).json({ error: '체결일은 최근 7일 이내만 가능합니다' })
    }

    const supabase = createClient(url, key)
    const user = await resolveUiUserContext(req)
    if (!user.authenticated) return res.status(401).json({ error: 'Authenticated session required' })

    // 웹 전용 계정 ID 발급이 일시 실패하면 현금·락 없이 체결되지 않도록 막는다
    if (!user.chatId) return res.status(503).json({ error: 'account not ready, retry' })

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
    if (isBackdated && isBotAccount) return res.status(400).json({ error: '지난 날짜 기록은 실계좌(계좌 이름이 있는 보유)만 가능합니다' })

    // 입력 가격이 기준 종가에서 상·하한가(±30%)를 벗어나면 오입력으로 보고 거절한다(종가를 모르는 종목은 통과)
    // 지난 날짜면 그날 종가, 없으면 최근 종가를 기준으로 한다
    let lastClose = NaN
    if (isBackdated) {
      const { data: dayRow } = await supabase
        .from('stock_daily')
        .select('close')
        .eq('ticker', String(code).trim().toUpperCase())
        .eq('date', tradeDate)
        .maybeSingle()
      lastClose = Number((dayRow as any)?.close)
    }
    if (!(lastClose > 0)) {
      const { data: closeRow, error: closeErr } = await supabase
        .from('stocks')
        .select('close')
        .eq('code', String(code).trim().toUpperCase())
        .maybeSingle()
      if (closeErr) return res.status(500).json({ error: closeErr.message })
      lastClose = Number((closeRow as any)?.close)
    }
    if (Number.isFinite(lastClose) && lastClose > 0 && (pr > lastClose * 1.3 || pr < lastClose * 0.7)) {
      return res.status(422).json({ error: `price out of range (last close ${lastClose}, allowed ±30%)` })
    }

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

    // 같은 주문이 5초 안에 다시 들어오면(더블클릭·재시도) 중복 체결로 보고 막는다(체결일이 과거일 수 있어 기록 시각 기준)
    const dupSince = new Date(Date.now() - 5000).toISOString()
    const { data: dupRows, error: dupErr } = await supabase
      .from('virtual_trades')
      .select('id')
      .eq(filterColumn, filterValue)
      .eq('code', String(code).trim().toUpperCase())
      .eq('side', sideUpper)
      .eq('quantity', qty)
      .eq('price', pr)
      .gte('created_at', dupSince)
      .limit(1)
    if (dupErr) return res.status(500).json({ error: dupErr.message })
    if (Array.isArray(dupRows) && dupRows.length > 0) {
      return res.status(409).json({ error: 'duplicate order within 5 seconds' })
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
      // 오늘 체결은 인자를 빼서 026 마이그레이션 전 함수와도 맞는다
      ...(isBackdated ? { p_trade_date: tradeDate } : {}),
    })

    if (tradeErr) {
      const rejected = /insufficient (holdings|virtual cash)/.test(tradeErr.message)
      return res.status(rejected ? 422 : 500).json({ error: tradeErr.message })
    }
    return res.status(200).json({ ok: true, trade })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
