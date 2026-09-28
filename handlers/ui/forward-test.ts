import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead, isAdminChatId, resolveRequesterChatId } from './_accessControl'
import { FORWARD_TEST_RESULT_PATH, type ForwardTestSnapshot } from '../../src/services/strategyForwardTest'
import {
  isStrategyName,
  loadStrategyActivation,
  recordStrategyDecision,
  type StrategyDecisionAction,
} from '../../src/services/strategyPromotion'

// 전략 경쟁 측정(전향검증) 최신 결과 — scripts/strategy_forward_test.ts 가 매일 저장한다.
// POST { strategy, action: approve|defer|deactivate } — 전략 승격 결정 (관리자만, strategyPromotion.ts 규칙)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (denyIfUnauthorizedRead(req, res)) return

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  try {
    if (req.method === 'POST') {
      const chatId = await resolveRequesterChatId(req)
      if (!isAdminChatId(chatId)) return res.status(403).json({ error: '전략 승격 결정은 관리자만 할 수 있습니다.' })
      const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) ?? {}
      const strategy = String(body.strategy ?? '')
      const action = String(body.action ?? '') as StrategyDecisionAction
      if (!isStrategyName(strategy) || !['approve', 'defer', 'deactivate'].includes(action)) {
        return res.status(400).json({ error: 'strategy/action 값이 올바르지 않습니다.' })
      }
      const result = await recordStrategyDecision(supabase, { strategy, action, by: String(chatId), source: 'web' })
      return res.status(result.ok ? 200 : 409).json({ ok: result.ok, message: result.message, activation: result.state ?? null })
    }

    const [{ data, error }, activation] = await Promise.all([
      supabase.storage.from('market-snapshots').download(FORWARD_TEST_RESULT_PATH),
      loadStrategyActivation(supabase).catch(() => null),
    ])
    const snapshot = error || !data ? null : (JSON.parse(await data.text()) as ForwardTestSnapshot)
    const requester = await resolveRequesterChatId(req).catch(() => null)
    res.setHeader('Cache-Control', 'private, max-age=60')
    return res.status(200).json({ ok: true, data: snapshot, activation, canDecide: isAdminChatId(requester) })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
