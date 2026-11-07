import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isAdminClientId, isAdminChatId, setUiCorsHeaders, denyIfUnauthorizedRead } from './_accessControl'
import { resolveUiUserContext } from './_userContext'

// 화면별 방문 집계 — POST는 로그인 사용자의 방문 1회 기록, GET은 관리자 전용 집계.
// 기록 실패는 화면에 영향 없어야 하므로 POST는 실패해도 200으로 답한다(집계는 참고용).
const SCREEN_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

function kstDay(d = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setUiCorsHeaders(req, res, 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (denyIfUnauthorizedRead(req, res)) return

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key)

  const user = await resolveUiUserContext(req)
  if (user.source !== 'auth' || !user.clientId) return res.status(401).json({ error: 'Sign-in required' })

  if (req.method === 'POST') {
    const screen = String((req.body as any)?.screen || '').trim()
    if (!SCREEN_RE.test(screen)) return res.status(400).json({ error: 'Invalid screen' })
    await supabase.rpc('screen_view_hit', { p_day: kstDay(), p_screen: screen, p_client: user.clientId })
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'GET') {
    if (!isAdminClientId(user.clientId) && !isAdminChatId(user.chatId)) return res.status(403).json({ error: 'Admin only' })
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 21))
    const since = kstDay(new Date(Date.now() - (days - 1) * 86400_000))
    // PostgREST 1000행 캡 — range 루프로 전부 읽는다
    const rows: Array<{ screen: string; client_id: string; views: number }> = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('screen_views')
        .select('screen,client_id,views')
        .gte('day', since)
        .order('day', { ascending: true })
        .order('screen', { ascending: true })
        .order('client_id', { ascending: true })
        .range(from, from + 999)
      if (error) return res.status(500).json({ error: error.message })
      rows.push(...((data || []) as typeof rows))
      if (!data || data.length < 1000) break
    }
    const by = new Map<string, { views: number; users: Set<string> }>()
    for (const r of rows) {
      const e = by.get(r.screen) || { views: 0, users: new Set<string>() }
      e.views += r.views
      e.users.add(r.client_id)
      by.set(r.screen, e)
    }
    const screens = [...by.entries()]
      .map(([screen, e]) => ({ screen, views: e.views, users: e.users.size }))
      .sort((a, b) => b.views - a.views)
    return res.status(200).json({ days, since, screens })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
