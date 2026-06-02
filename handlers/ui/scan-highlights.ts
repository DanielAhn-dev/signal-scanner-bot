import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createDailyCandidatePlanningReportResult } from '../../src/services/marketInsightService'
import { scoreLeadAccumulationCandidate } from '../../src/services/accumulationSignalService'
import { denyIfUnauthorizedRead } from './_accessControl'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'
const CACHE_TTL_MS = 300_000 // 5분 (캐시 자주 갱신되지 않으므로)

type CacheEntry = {
  expiresAt: number
  data: ScanHighlightItem[]
}

const cache = new Map<string, CacheEntry>()

type InvestorFlowWindow = {
  foreignNetBuy5d: number
  institutionNetBuy5d: number
  foreignNetBuy20d: number
  institutionNetBuy20d: number
}

function shiftDateText(baseDateText: string, days: number): string {
  const base = Date.parse(`${baseDateText}T00:00:00+09:00`)
  if (Number.isNaN(base)) {
    const fallback = new Date(Date.now() - days * 86_400_000)
    return fallback.toISOString().slice(0, 10)
  }
  const shifted = new Date(base - days * 86_400_000)
  return shifted.toISOString().slice(0, 10)
}

async function fetchInvestorFlowByCode(
  supabase: SupabaseClient,
  codes: string[],
  asOfDate: string,
): Promise<Map<string, InvestorFlowWindow>> {
  const out = new Map<string, InvestorFlowWindow>()
  if (codes.length === 0) return out

  const fromDate = shiftDateText(asOfDate, 35)
  const attempts: Array<{ codeCol: 'ticker' | 'code'; select: string }> = [
    { codeCol: 'ticker', select: 'ticker,date,foreign_amount,institution_amount,foreign,institution,foreign_net,institution_net' },
    { codeCol: 'code', select: 'code,date,foreign_amount,institution_amount,foreign,institution,foreign_net,institution_net' },
  ]

  for (const spec of attempts) {
    try {
      const { data, error } = await supabase
        .from('investor_daily')
        .select(spec.select)
        .in(spec.codeCol, codes)
        .gte('date', fromDate)
        .lte('date', asOfDate)
        .order('date', { ascending: false })

      if (error || !Array.isArray(data)) continue

      const grouped = new Map<string, any[]>()
      for (const row of data) {
        const code = String((row as any)?.[spec.codeCol] || '').trim()
        if (!code) continue
        const rows = grouped.get(code) ?? []
        rows.push(row)
        grouped.set(code, rows)
      }

      for (const code of codes) {
        const rows = grouped.get(code) ?? []
        if (rows.length === 0) continue
        const rows5d = rows.slice(0, 5)
        const rows20d = rows.slice(0, 20)
        let foreignNetBuy5d = 0
        let institutionNetBuy5d = 0
        let foreignNetBuy20d = 0
        let institutionNetBuy20d = 0
        let hasAnyFlowValue = false
        for (const row of rows5d) {
          const foreignRaw = (row as any)?.foreign_amount ?? (row as any)?.foreign ?? (row as any)?.foreign_net
          const institutionRaw = (row as any)?.institution_amount ?? (row as any)?.institution ?? (row as any)?.institution_net
          const foreign = Number(foreignRaw)
          const institution = Number(institutionRaw)
          if (Number.isFinite(foreign) || Number.isFinite(institution)) hasAnyFlowValue = true
          foreignNetBuy5d += Number.isFinite(foreign) ? foreign : 0
          institutionNetBuy5d += Number.isFinite(institution) ? institution : 0
        }
        for (const row of rows20d) {
          const foreignRaw = (row as any)?.foreign_amount ?? (row as any)?.foreign ?? (row as any)?.foreign_net
          const institutionRaw = (row as any)?.institution_amount ?? (row as any)?.institution ?? (row as any)?.institution_net
          const foreign = Number(foreignRaw)
          const institution = Number(institutionRaw)
          if (Number.isFinite(foreign) || Number.isFinite(institution)) hasAnyFlowValue = true
          foreignNetBuy20d += Number.isFinite(foreign) ? foreign : 0
          institutionNetBuy20d += Number.isFinite(institution) ? institution : 0
        }
        if (!hasAnyFlowValue) continue
        out.set(code, {
          foreignNetBuy5d,
          institutionNetBuy5d,
          foreignNetBuy20d,
          institutionNetBuy20d,
        })
      }

      if (out.size > 0) return out
    } catch {
      // continue
    }
  }

  return out
}

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
  foreign_net_buy_5d?: number | null
  institution_net_buy_5d?: number | null
  foreign5d?: number | null
  institution5d?: number | null
  foreign_net_buy_20d?: number | null
  institution_net_buy_20d?: number | null
  foreign20d?: number | null
  institution20d?: number | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (denyIfUnauthorizedRead(req, res)) return


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
    const rankedCodes = ranked.map((f) => f.code)
    const asOfDate = new Date().toISOString().slice(0, 10)
    const investorFlowByCode = await fetchInvestorFlowByCode(supabase, rankedCodes, asOfDate)

    // ranked 코드에 대한 grade 데이터 조회
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
      const investorFlow = investorFlowByCode.get(f.code)
      const foreignNetBuy5d = investorFlow?.foreignNetBuy5d ?? null
      const institutionNetBuy5d = investorFlow?.institutionNetBuy5d ?? null
      const foreignNetBuy20d = investorFlow?.foreignNetBuy20d ?? null
      const institutionNetBuy20d = investorFlow?.institutionNetBuy20d ?? null
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
        foreign_net_buy_5d: foreignNetBuy5d,
        institution_net_buy_5d: institutionNetBuy5d,
        foreign5d: foreignNetBuy5d,
        institution5d: institutionNetBuy5d,
        foreign_net_buy_20d: foreignNetBuy20d,
        institution_net_buy_20d: institutionNetBuy20d,
        foreign20d: foreignNetBuy20d,
        institution20d: institutionNetBuy20d,
      }
    })

    cache.set('highlights', { expiresAt: Date.now() + CACHE_TTL_MS, data })
    return res.status(200).json({ ok: true, cached: false, data })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
