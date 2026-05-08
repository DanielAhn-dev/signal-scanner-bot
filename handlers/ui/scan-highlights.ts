import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { applyAdaptiveOverlayToPullbackCandidate, getAdaptiveStrategyInsights } from '../../src/services/adaptiveStrategyService'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'
const CACHE_TTL_MS = 60_000 // 1분

type CacheEntry = {
  expiresAt: number
  latestDate: string | null
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
}

function signalBonus(signal: string | null | undefined): number {
  const s = String(signal || '').toUpperCase().trim()
  if (s === 'STRONG_BUY') return 15
  if (s === 'BUY') return 8
  if (s === 'WATCH') return 3
  return 0
}

function stableBonus(stableTurn: string | null | undefined): number {
  const s = String(stableTurn || '').toLowerCase().trim()
  if (s === 'bull-strong') return 10
  if (s === 'bull-weak') return 5
  return 0
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
    return res.status(200).json({ ok: true, cached: true, latestDate: cached.latestDate, data: cached.data })
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const adaptiveInsights = await getAdaptiveStrategyInsights(supabase)

    // 1) 최신 trade_date 조회
    const { data: latestRows, error: latestError } = await supabase
      .from('pullback_signals')
      .select('trade_date')
      .order('trade_date', { ascending: false })
      .limit(1)
    if (latestError) return res.status(500).json({ error: latestError.message })
    const latestDate = (latestRows?.[0]?.trade_date as string) ?? null
    if (!latestDate) return res.status(200).json({ ok: true, latestDate: null, data: [] })

    // 2) 진입 A/B, SELL 제외 후보
    const { data: pbRows, error: pbError } = await supabase
      .from('pullback_signals')
      .select('code, entry_grade, entry_score, trend_grade, dist_grade, pivot_grade, warn_grade, warn_score')
      .eq('trade_date', latestDate)
      .in('entry_grade', ['A', 'B'])
      .neq('warn_grade', 'SELL')
      .order('entry_score', { ascending: false })
      .limit(80)
    if (pbError) return res.status(500).json({ error: pbError.message })

    const codes = (pbRows ?? []).map((r: any) => r.code as string).filter(Boolean)
    if (!codes.length) return res.status(200).json({ ok: true, latestDate, data: [] })

    // 3) 종목명/섹터 조회
    const { data: stockRows } = await supabase
      .from('stocks')
      .select('code, name, sector_id')
      .in('code', codes)
    const stockMap = new Map<string, { name: string; sector_id: string | null }>()
    for (const s of (stockRows ?? []) as any[]) {
      stockMap.set(s.code, { name: s.name, sector_id: s.sector_id ?? null })
    }

    // 4) scores 최신 asof 조회 후 교차
    const { data: latestScoreRows } = await supabase
      .from('scores')
      .select('asof')
      .order('asof', { ascending: false })
      .limit(1)
    const latestAsof = (latestScoreRows?.[0]?.asof as string) ?? null

    const scoreMap = new Map<string, { signal: string | null; stableTurn: string | null; totalScore: number | null }>()
    if (latestAsof) {
      const { data: scoreRows } = await supabase
        .from('scores')
        .select('code, signal, total_score, factors')
        .eq('asof', latestAsof)
        .in('code', codes)
      for (const row of (scoreRows ?? []) as any[]) {
        const factors = row.factors ?? {}
        scoreMap.set(row.code, {
          signal: String(row.signal || '') || null,
          stableTurn: String(factors?.stable_turn || '') || null,
          totalScore: typeof row.total_score === 'number' ? row.total_score : null,
        })
      }
    }

    // 5) highlight_score 계산 및 TOP5 추출
    const items: ScanHighlightItem[] = (pbRows ?? []).map((row: any) => {
      const stock = stockMap.get(row.code)
      const entryScore = Number(row.entry_score ?? 0)
      const warnScore = Number(row.warn_score ?? 0)
      const sc = scoreMap.get(row.code)
      const priorityBase = entryScore * 20 - warnScore * 3
      const highlightScore = priorityBase + signalBonus(sc?.signal) + stableBonus(sc?.stableTurn)
      const adaptive = applyAdaptiveOverlayToPullbackCandidate(row, adaptiveInsights)
      return {
        code: row.code,
        name: stock?.name ?? row.code,
        sector_id: stock?.sector_id ?? null,
        entry_grade: row.entry_grade ?? null,
        entry_score: row.entry_score ?? null,
        trend_grade: row.trend_grade ?? null,
        dist_grade: row.dist_grade ?? null,
        pivot_grade: row.pivot_grade ?? null,
        warn_grade: row.warn_grade ?? null,
        warn_score: row.warn_score ?? null,
        signal: sc?.signal ?? null,
        stable_turn: sc?.stableTurn ?? null,
        total_score: sc?.totalScore ?? null,
        highlight_score: highlightScore,
        adaptive_adjustment: adaptive.adjustment,
        adaptive_reasons: adaptive.reasons,
        adaptive_score: round1(highlightScore + adaptive.adjustment),
      }
    })

    items.sort((a, b) => Number(b.adaptive_score ?? b.highlight_score) - Number(a.adaptive_score ?? a.highlight_score))
    const top5 = items.slice(0, 5)

    cache.set('highlights', { expiresAt: Date.now() + CACHE_TTL_MS, latestDate, data: top5 })
    return res.status(200).json({ ok: true, cached: false, latestDate, data: top5 })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
