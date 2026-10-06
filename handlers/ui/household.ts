import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { setUiCorsHeaders } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { readUserStateFor } from './user-state'
import { fetchAccountEquity } from '../../src/services/goalTracker'
import { kstDateKey } from '../../src/services/virtualAutoTradeTiming'
import {
  COUPLE_REASON_MESSAGE, acceptCoupleCode, cancelCoupleCode, createCoupleCode, endCouple, getHousehold, parseSharesPatch, setMyShares,
} from '../../src/services/household'

// 부부 연결 (src/services/household.ts)
// GET                         내 연결 상태 + (연결됐으면) 상대가 공유한 투자 요약·자녀 기록
// POST {action:'create-code'} 연결 코드 만들기 / 'cancel-code' / 'accept' {code} / 'end' / 'set-shares' {shares}
async function partnerView(supabase: any, partnerClientId: string, shares: { investing: boolean; children: boolean; plan: boolean }) {
  const { data: profile } = await supabase.from('web_user_profiles').select('nickname,telegram_id').eq('client_id', partnerClientId).maybeSingle()
  const out: Record<string, unknown> = { nickname: profile?.nickname || null }
  const chatId = Number(profile?.telegram_id)
  if (shares.investing && Number.isFinite(chatId) && chatId > 0) {
    const equity = await fetchAccountEquity(supabase, chatId, kstDateKey())
    out.investing = equity
      ? { seed: equity.seed, total: equity.total, cash: equity.cash, holdings: equity.holdings, monthlyDeposit: equity.monthlyDeposit, principal: equity.principal }
      : null
  }
  if (shares.plan) {
    // 가장 최근 '지금 상태 점검' 입력. 결과는 화면이 같은 계산(evaluateFlowCheck)으로 만든다
    const { data } = await supabase.from('money_flow_checks').select('checked_on,input').eq('client_id', partnerClientId)
      .order('checked_on', { ascending: false }).order('created_at', { ascending: false }).limit(1)
    const row = (data as Array<{ checked_on: string; input: unknown }> | null)?.[0]
    out.check = row ? { date: String(row.checked_on).slice(0, 10), input: row.input } : null
  }
  if (shares.children) {
    const state = await readUserStateFor(supabase, partnerClientId)
    out.children = state.childGifts?.value ?? null
  }
  return out
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setUiCorsHeaders(req, res, 'GET,POST,OPTIONS')
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!['GET', 'POST'].includes(req.method ?? '')) return res.status(405).json({ error: 'Method not allowed' })

  const user = await resolveUiUserContext(req)
  if (!user.authenticated || !user.clientId) return res.status(401).json({ error: 'Login required' })
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const clientId = user.clientId

  try {
    if (req.method === 'GET') {
      const view = await getHousehold(supabase, clientId)
      if (view.status !== 'active') return res.status(200).json({ data: view })
      const { partnerClientId, ...rest } = view
      // 상대 client_id는 화면에 내보내지 않는다
      return res.status(200).json({ data: { ...rest, partner: await partnerView(supabase, partnerClientId, view.partnerShares) } })
    }

    const body = (typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body) } catch { return null } })() : req.body) ?? {}
    const action = String(body.action || '')
    const reply = (result: { ok: boolean; reason?: string } & Record<string, unknown>) =>
      result.ok ? res.status(200).json(result) : res.status(200).json({ ...result, error: COUPLE_REASON_MESSAGE[result.reason ?? 'server_error'] })

    if (action === 'create-code') return reply(await createCoupleCode(supabase, clientId))
    if (action === 'cancel-code') { await cancelCoupleCode(supabase, clientId); return res.status(200).json({ ok: true }) }
    if (action === 'accept') return reply(await acceptCoupleCode(supabase, clientId, body.code))
    if (action === 'end') return reply(await endCouple(supabase, clientId))
    if (action === 'set-shares') {
      const patch = parseSharesPatch(body.shares)
      if (!patch) return res.status(400).json({ error: 'Invalid shares' })
      return reply(await setMyShares(supabase, clientId, patch))
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
