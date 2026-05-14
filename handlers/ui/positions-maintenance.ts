import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'

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

function asPositiveNumber(input: unknown): number | null {
  const n = Number(input)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function normalizeLabel(input: unknown): string | null {
  const v = String(input || '').trim()
  return v ? v : null
}

function normalizeYmdDate(input: unknown): string | null {
  const v = String(input || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const t = Date.parse(`${v}T00:00:00Z`)
  if (!Number.isFinite(t)) return null
  return v
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestOrigin = String(req.headers.origin || '').trim()
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    process.env.UI_CORS_ORIGIN ||
    'https://signal-scanner-web.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

  const allowOrigin = requestOrigin && trustedOrigins.includes(requestOrigin)
    ? requestOrigin
    : (trustedOrigins[0] || '*')

  res.setHeader('Access-Control-Allow-Origin', allowOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const expectedReadKey = process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  const readKey = req.headers['x-ui-key'] || req.query.ui_key
  const isTrustedOrigin = !!requestOrigin && trustedOrigins.includes(requestOrigin)
  if (expectedReadKey && !isTrustedOrigin && String(readKey || '') !== expectedReadKey) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const user = resolveUiUserContext(req)
  const chatId = user.chatId
  if (!chatId) return res.status(400).json({ error: 'chat_id required' })

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }

  try {
    const body = (req.body || {}) as any
    const mode = String(body.mode || '').trim().toLowerCase()

    if (mode === 'watchreset') {
      const { error: delErr, count } = await supabase
        .from('virtual_positions')
        .delete({ count: 'exact' })
        .eq('chat_id', chatId)
        .or('quantity.is.null,quantity.eq.0,status.eq.interest,status.eq.watch')

      if (delErr) return res.status(500).json({ error: delErr.message })
      return res.status(200).json({ ok: true, mode, removed: Number(count || 0) })
    }

    if (mode === 'holdingedit') {
      const code = normalizeCode(body.code)
      const buyPrice = asPositiveNumber(body.buy_price)
      const quantity = Math.max(1, Math.trunc(Number(body.quantity || 1)))
      const buyDate = normalizeYmdDate(body.buy_date) || new Date().toISOString().slice(0, 10)
      const brokerName = normalizeLabel(body.broker_name)
      const accountName = normalizeLabel(body.account_name)

      if (!code) return res.status(400).json({ error: 'code required' })
      if (!buyPrice) return res.status(400).json({ error: 'buy_price must be > 0' })
      if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'quantity must be >= 1' })

      const { data: position, error: posErr } = await supabase
        .from('virtual_positions')
        .select('id,code,chat_id,buy_price,quantity,buy_date')
        .eq('chat_id', chatId)
        .eq('code', code)
        .maybeSingle()

      if (posErr) return res.status(500).json({ error: posErr.message })
      if (!position) return res.status(404).json({ error: 'position not found' })

      const investedAmount = buyPrice * quantity
      const acquiredAtIso = `${buyDate}T00:00:00.000Z`
      const nowIso = new Date().toISOString()

      // 기존 값을 저장 (감사 추적용)
      const oldBuyPrice = Number(position.buy_price || 0)
      const oldQuantity = Math.max(1, Number(position.quantity || 1))

      // 1. ADJUST 거래 기록 - 수정 내용 추적
      if (oldBuyPrice !== buyPrice || oldQuantity !== quantity) {
        const adjustMemo = `web-edit: ${oldQuantity}@${oldBuyPrice}원 → ${quantity}@${buyPrice}원`
        const { error: adjustErr } = await supabase.from('virtual_trades').insert([{
          chat_id: chatId,
          code,
          side: 'ADJUST',
          price: buyPrice,
          quantity: quantity,
          gross_amount: 0,
          net_amount: 0,
          fee_amount: 0,
          tax_amount: 0,
          pnl_amount: 0,
          memo: adjustMemo,
          broker_name: brokerName,
          account_name: accountName,
          created_at: nowIso,
        }])
        if (adjustErr) {
          console.warn('ADJUST 거래 기록 실패:', adjustErr.message)
          // ADJUST 기록 실패는 치명적이지 않으므로 계속 진행
        }
      }

      // 2. 포지션 업데이트
      const { data: updated, error: upErr } = await supabase
        .from('virtual_positions')
        .update({
          buy_price: buyPrice,
          quantity,
          invested_amount: investedAmount,
          status: 'holding',
          buy_date: buyDate,
          broker_name: brokerName,
          account_name: accountName,
        })
        .eq('id', position.id)
        .select('id,code,buy_price,quantity,invested_amount,status,buy_date,broker_name,account_name')
        .single()

      if (upErr) return res.status(500).json({ error: upErr.message })

      // 3. 기존 로트는 유지하고, 수정된 값으로 새 로트만 추가 기록
      // (기존 로트 DELETE 제거 - 거래이력 보존)
      const { error: lotErr } = await supabase.from('virtual_trade_lots').insert([{
        chat_id: chatId,
        code,
        position_id: position.id,
        acquired_price: buyPrice,
        acquired_quantity: quantity,
        remaining_quantity: quantity,
        acquired_at: acquiredAtIso,
      }])

      if (lotErr) {
        console.warn('새 로트 기록 실패:', lotErr.message)
        // 로트 기록 실패해도 포지션은 이미 업데이트되었으므로 계속 진행
      }

      return res.status(200).json({ ok: true, mode, data: updated })
    }

    if (mode === 'liquidateall') {
      const { data: holdings, error: holdErr } = await supabase
        .from('virtual_positions')
        .select('id,code,quantity,buy_price,status,broker_name,account_name,stock:stocks(close)')
        .eq('chat_id', chatId)
        .gt('quantity', 0)

      if (holdErr) return res.status(500).json({ error: holdErr.message })
      const rows = Array.isArray(holdings) ? holdings : []
      if (rows.length === 0) return res.status(200).json({ ok: true, mode, soldCount: 0 })

      const nowIso = new Date().toISOString()
      const trades = rows.map((row: any) => {
        const qty = Math.max(0, Number(row.quantity || 0))
        const px = asPositiveNumber(row?.stock?.close) || asPositiveNumber(row.buy_price) || 0
        const gross = qty * px
        return {
          chat_id: chatId,
          code: String(row.code),
          side: 'SELL',
          price: px,
          quantity: qty,
          gross_amount: gross,
          net_amount: gross,
          fee_amount: 0,
          tax_amount: 0,
          broker_name: String(row?.broker_name || '').trim() || null,
          account_name: String(row?.account_name || '').trim() || null,
          memo: '웹 전체매도',
          source: 'MANUAL',
          created_at: nowIso,
        }
      })

      const { error: tradeErr } = await supabase.from('virtual_trades').insert(trades)
      if (tradeErr) return res.status(500).json({ error: tradeErr.message })

      const ids = rows.map((r: any) => r.id).filter(Boolean)
      const { error: updateErr } = await supabase
        .from('virtual_positions')
        .update({ quantity: 0, invested_amount: 0, status: 'interest' })
        .in('id', ids)

      if (updateErr) return res.status(500).json({ error: updateErr.message })

      await supabase
        .from('virtual_trade_lots')
        .update({ remaining_quantity: 0, closed_at: nowIso })
        .eq('chat_id', chatId)
        .in('code', rows.map((r: any) => String(r.code)))
        .gt('remaining_quantity', 0)

      return res.status(200).json({ ok: true, mode, soldCount: rows.length })
    }

    if (mode === 'holdingrestore') {
      const code = normalizeCode(body.code)
      const buyPrice = asPositiveNumber(body.buy_price)
      const quantity = Math.max(1, Math.trunc(Number(body.quantity || 1)))
      const buyDate = normalizeYmdDate(body.buy_date) || new Date().toISOString().slice(0, 10)
      const brokerName = normalizeLabel(body.broker_name)
      const accountName = normalizeLabel(body.account_name)

      if (!code) return res.status(400).json({ error: 'code required' })
      if (!buyPrice) return res.status(400).json({ error: 'buy_price must be > 0' })
      if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'quantity must be >= 1' })

      // 종목 존재 여부 확인
      const { data: stock, error: stockErr } = await supabase
        .from('stocks')
        .select('code,name')
        .eq('code', code)
        .maybeSingle()
      if (stockErr) return res.status(500).json({ error: stockErr.message })
      if (!stock) return res.status(404).json({ error: `종목코드 ${code}를 찾을 수 없습니다` })

      const investedAmount = Math.round(buyPrice * quantity)
      const nowIso = new Date().toISOString()
      const acquiredAtIso = `${buyDate}T00:00:00.000Z`

      // 기존 포지션 조회 (없으면 신규 생성)
      const { data: existing, error: posErr } = await supabase
        .from('virtual_positions')
        .select('id,code,chat_id')
        .eq('chat_id', chatId)
        .eq('code', code)
        .maybeSingle()
      if (posErr) return res.status(500).json({ error: posErr.message })

      let positionId: string | number

      if (existing) {
        const { data: updated, error: upErr } = await supabase
          .from('virtual_positions')
          .update({
            buy_price: buyPrice,
            quantity,
            invested_amount: investedAmount,
            status: 'holding',
            buy_date: buyDate,
            memo: 'web-restore:v1',
            broker_name: brokerName,
            account_name: accountName,
          })
          .eq('id', (existing as any).id)
          .select('id')
          .single()
        if (upErr) return res.status(500).json({ error: upErr.message })
        positionId = (updated as any).id
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from('virtual_positions')
          .insert({
            chat_id: chatId,
            code,
            buy_price: buyPrice,
            quantity,
            invested_amount: investedAmount,
            status: 'holding',
            buy_date: buyDate,
            memo: 'web-restore:v1',
            broker_name: brokerName,
            account_name: accountName,
          })
          .select('id')
          .single()
        if (insErr) return res.status(500).json({ error: insErr.message })
        positionId = (inserted as any).id
      }

      // 거래 로그 기록 (ADJUST)
      await supabase.from('virtual_trades').insert([{
        chat_id: chatId,
        code,
        side: 'ADJUST',
        price: buyPrice,
        quantity,
        gross_amount: investedAmount,
        net_amount: investedAmount,
        fee_amount: 0,
        tax_amount: 0,
        memo: `web-restore:v1;buy=${buyPrice};qty=${quantity}`,
        created_at: nowIso,
      }])

      // 로트 교체
      await supabase.from('virtual_trade_lots').delete().eq('position_id', positionId)
      await supabase.from('virtual_trade_lots').insert([{
        chat_id: chatId,
        code,
        position_id: positionId,
        acquired_price: buyPrice,
        acquired_quantity: quantity,
        remaining_quantity: quantity,
        acquired_at: acquiredAtIso,
      }])

      return res.status(200).json({
        ok: true,
        mode,
        created: !existing,
        data: {
          code,
          stock_name: (stock as any).name,
          buy_price: buyPrice,
          quantity,
          invested_amount: investedAmount,
          broker_name: brokerName,
          account_name: accountName,
        },
      })
    }

    return res.status(400).json({ error: 'unsupported mode' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
