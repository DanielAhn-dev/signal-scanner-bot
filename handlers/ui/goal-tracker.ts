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
  saveGoalSettings,
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
    if (req.method === 'POST') {
      const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) ?? {}
      const saved = await saveGoalSettings(supabase, chatId, body)
      if (!saved) return res.status(409).json({ error: '목표 기록이 아직 없습니다. 화면을 새로고침한 뒤 다시 저장하세요.' })
    }
    const now = await fetchAccountEquity(supabase, chatId, today)
    if (!now) return res.status(200).json({ ok: true, data: null, reason: '가상 계좌(시드) 설정이 없습니다. /투자금 으로 시드를 설정하세요.' })
    const file = await recordGoalEquity(supabase, chatId, { date: now.date, seed: now.seed, total: now.total })
    const realized = await fetchMonthRealized(supabase, chatId, today)
    return res.status(200).json({ ok: true, data: buildGoalTrackerView({ file, now, realized }) })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
