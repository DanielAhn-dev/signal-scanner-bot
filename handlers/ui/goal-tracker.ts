import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { kstDateKey } from '../../src/services/virtualAutoTradeTiming'
import {
  buildGoalTrackerView,
  fetchAccountEquity,
  fetchMonthRealized,
  recordGoalEquity,
} from '../../src/services/goalTracker'

// 목표 트래커 (src/services/goalTracker.ts) — GET: 오늘 평가액을 기록하고 진행 상황 반환 / POST: 목표 설정 변경
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

  const user = await resolveUiUserContext(req)
  const chatId = user.chatId
  if (!chatId) return res.status(400).json({ error: 'chat_id required' })

  try {
    const today = kstDateKey()
    const patch =
      req.method === 'POST' ? ((typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) ?? {}) : undefined
    const now = await fetchAccountEquity(supabase, chatId, today)
    if (!now) return res.status(200).json({ ok: true, data: null, reason: '가상 계좌(시드) 설정이 없습니다. /투자금 으로 시드를 설정하세요.' })
    // 설정 변경과 오늘 기록을 한 번에 쓴다 — 따로 쓰면 뒤의 기록이 옛 설정으로 덮어쓴다
    const file = await recordGoalEquity(supabase, chatId, { date: now.date, seed: now.seed, total: now.total, realized: now.realized }, patch)
    const realized = await fetchMonthRealized(supabase, chatId, today)
    return res.status(200).json({ ok: true, data: buildGoalTrackerView({ file, now, realized }) })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
