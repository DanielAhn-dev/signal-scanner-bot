import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { loadGoalFile } from '../../src/services/goalTracker'
import { getDailySeries } from '../../src/adapters'
import { buildChoiceReview, sanitizeEvents, type CloseSeries } from '../../src/services/choiceReview'

// 내 선택 돌아보기 (src/services/choiceReview.ts)
// POST { events } — 클라이언트가 가진 전환 기록(user-state 'switchHistory')에 실제 평가액 기록과 가격 이력을 붙여 비교 결과를 돌려준다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,x-user-client-id,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (denyIfUnauthorizedRead(req, res)) return

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const user = await resolveUiUserContext(req)
  const chatId = user.chatId
  if (!chatId) return res.status(400).json({ error: 'chat_id required' })

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) ?? {}
    const events = sanitizeEvents(body.events)
    if (!events.length) return res.status(200).json({ data: [] })

    const file = await loadGoalFile(supabase, chatId)
    const history = file?.history ?? []

    const codes = [...new Set(events.flatMap((e) => e.holdings.map((h) => h.code)))].slice(0, 24)
    const closes: Record<string, CloseSeries> = {}
    await Promise.all(codes.map(async (code) => {
      try {
        const series = await getDailySeries(code, 420)
        closes[code] = series.map((p) => ({ date: p.date, close: p.close })).filter((p) => p.close > 0)
      } catch {
        closes[code] = []
      }
    }))

    return res.status(200).json({ data: events.map((event) => buildChoiceReview({ event, history, closes })) })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
