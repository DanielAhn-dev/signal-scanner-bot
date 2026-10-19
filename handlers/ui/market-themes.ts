import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'
import { loadThemeDays, loadThemeMeta } from '../../src/services/marketThemeStore'
import { buildThemeFlow, BASELINE_DAYS, COOLING_LOOKBACK, HOT_WEIGHTS, RECENT_DAYS } from '../../src/lib/themeFlow'

// 웹 '오늘 시장' — 뜨는·식는 테마 (계산 src/lib/themeFlow.ts, 수집 scripts/collect_market_themes.ts)
//   GET → { data: ThemeFlow & { weights, recentDays, baselineDays } } 공개 시장 데이터라 신원은 받지 않는다

/** 5일 + 평소 20일 + 식는 테마 10일 ≒ 35거래일 → 달력 70일 */
const LOOKBACK_CALENDAR_DAYS = Math.ceil((RECENT_DAYS + BASELINE_DAYS + COOLING_LOOKBACK) * 2)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (denyIfUnauthorizedRead(req, res)) return

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  try {
    const sinceDate = new Date(Date.now() - LOOKBACK_CALENDAR_DAYS * 86_400_000).toISOString().slice(0, 10)
    const [meta, days] = await Promise.all([loadThemeMeta(supabase), loadThemeDays(supabase, { sinceDate })])
    const flow = buildThemeFlow(days, meta)
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=600')
    return res.status(200).json({ data: { ...flow, weights: HOT_WEIGHTS, recentDays: RECENT_DAYS, baselineDays: BASELINE_DAYS } })
  } catch (e) {
    // 조회 실패를 '테마 없음'으로 내보내지 않는다 — 웹은 실패 상태를 보여 준다
    return res.status(503).json({ error: `테마 기록 조회 실패: ${e instanceof Error ? e.message : String(e)}` })
  }
}
