import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createDailyCandidatePlanningReportResult } from '../../src/services/marketInsightService'
import { scoreLeadAccumulationCandidate } from '../../src/services/accumulationSignalService'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'
const CACHE_TTL_MS = 300_000 // 5분 (캐시 자주 갱신되지 않으므로)

type CacheEntry = {
  expiresAt: number
  data: ScanHighlightItem[]
}

const cache = new Map<string, CacheEntry>()

let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) throw new Error('Server not configured')
  _supabase = createClient(url, key, { auth: { persistSession: false } })
  return _supabase
}

export type ScanHighlightItem = {
  code: string
  name: string
  sector_id: string | null
  entry_grade: string | null
  entry_score: number | null
  trend_grade: string | null
  dist_grade: string | null
  pivot_grade: string | null
  warn_grade: string | null
  warn_score: number | null
  signal: string | null
  stable_turn: string | null
  total_score: number | null
  highlight_score: number
  adaptive_adjustment?: number
  adaptive_reasons?: string[]
  adaptive_score?: number
  lead_accumulation_score?: number
  lead_accumulation_stage?: 'none' | 'lead' | 'breakout'
  // forecast fields
  entry_price: number | null
  strategy_label: string
  expected_base_pct: number
  expected_upside_pct: number
  expected_drawdown_pct: number
  confidence_pct: number
  score_momentum: number
  score_value: number
  score_safety: number
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const expectedReadKey = process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  const readKey = req.headers['x-ui-key'] || req.query.ui_key
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    'https://signal-scanner-web.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const isTrustedOrigin = !!origin && trustedOrigins.includes(origin)
  if (expectedReadKey && !isTrustedOrigin && String(readKey || '') !== expectedReadKey) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const cached = cache.get('highlights')
  if (cached && Date.now() <= cached.expiresAt) {
    return res.status(200).json({ ok: true, cached: true, data: cached.data })
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    // 최상위 5개만 필요하므로 briefing 모드로 경량화
    const report = await createDailyCandidatePlanningReportResult(supabase, {
      riskProfile: 'safe',
      mode: 'briefing',
    })

    const forecasts = report.forecasts ?? []
    if (!forecasts.length) {
      return res.status(200).json({ ok: true, cached: false, data: [] })
    }

    // 확신추천과 동일한 정렬: confidencePct desc → edge(upside-drawdown) desc
    const ranked = [...forecasts].sort((a, b) => {
      if (b.confidencePct !== a.confidencePct) return b.confidencePct - a.confidencePct
      const aEdge = a.expectedUpsidePct - a.expectedDrawdownPct
      const bEdge = b.expectedUpsidePct - b.expectedDrawdownPct
      return bEdge - aEdge
    }).slice(0, 5)

    // ranked 코드에 대한 grade 데이터 조회
    const rankedCodes = ranked.map((f) => f.code)
    const { data: gradeRows } = await supabase
      .from('pullback_signals')
      .select('code, entry_grade, entry_score, trend_grade, dist_grade, pivot_grade, warn_grade, warn_score, trade_date, stock:stocks!inner(sector_id)')
      .in('code', rankedCodes)
      .order('trade_date', { ascending: false })

    // 코드별 최신 grade 행만 유지
    const gradeMap = new Map<string, any>()
    for (const row of gradeRows ?? []) {
      if (!gradeMap.has(row.code)) gradeMap.set(row.code, row)
    }

    const data: ScanHighlightItem[] = ranked.map((f) => {
      const g = gradeMap.get(f.code)
      const leadSignal = scoreLeadAccumulationCandidate(g ?? {})
      return {
        code: f.code,
        name: f.name,
        sector_id: (g?.stock as any)?.sector_id ?? null,
        entry_grade: g?.entry_grade ?? null,
        entry_score: g?.entry_score ?? null,
        trend_grade: g?.trend_grade ?? null,
        dist_grade: g?.dist_grade ?? null,
        pivot_grade: g?.pivot_grade ?? null,
        warn_grade: g?.warn_grade ?? null,
        warn_score: g?.warn_score ?? null,
        signal: null,
        stable_turn: null,
        total_score: null,
        highlight_score: f.confidencePct,
        adaptive_score: f.confidencePct,
        lead_accumulation_score: leadSignal.score,
        lead_accumulation_stage: leadSignal.stage,
        entry_price: f.entryPrice > 0 ? f.entryPrice : null,
        strategy_label: f.strategyLabel,
        expected_base_pct: f.expectedBasePct,
        expected_upside_pct: f.expectedUpsidePct,
        expected_drawdown_pct: f.expectedDrawdownPct,
        confidence_pct: f.confidencePct,
        score_momentum: f.scoreComponents.momentum,
        score_value: f.scoreComponents.value,
        score_safety: f.scoreComponents.safety,
      }
    })

    cache.set('highlights', { expiresAt: Date.now() + CACHE_TTL_MS, data })
    return res.status(200).json({ ok: true, cached: false, data })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
