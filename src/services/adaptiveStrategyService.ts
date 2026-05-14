import type { SupabaseClient } from '@supabase/supabase-js'

type FactorKey = 'entry_grade' | 'trend_grade' | 'pivot_grade' | 'warn_grade' | 'signal' | 'stable_turn' | 'market_regime'

type PullbackHistoryRow = {
  trade_date: string
  code: string
  entry_grade: string | null
  trend_grade: string | null
  pivot_grade: string | null
  warn_grade: string | null
  signal: string | null
  stable_turn: string | null
  market_regime: string | null
}

type PriceRow = {
  code: string
  date: string
  close: number
}

type FactorAccumulator = {
  count: number
  wins: number
  returnSum: number
}

export type AdaptiveFactorStat = {
  key: FactorKey
  factor: string
  label: string
  sampleCount: number
  winRatePct: number
  avgForwardReturnPct: number
  weight: number
}

export type AdaptiveStrategyInsights = {
  latestTradeDate: string | null
  horizonBars: number
  sampleCount: number
  baseHitRatePct: number
  baseAvgReturnPct: number
  strengthScore: number
  todayBiasSummary: string
  topPositiveFactors: AdaptiveFactorStat[]
  topNegativeFactors: AdaptiveFactorStat[]
  factorWeights: Partial<Record<FactorKey, Record<string, number>>>
}

type AdaptiveOverlay = {
  adjustment: number
  reasons: string[]
}

const CACHE_TTL_MS = 5 * 60_000
const PRICE_TABLES = ['stock_prices', 'stock_timeseries', 'stock_history'] as const
const FACTOR_KEYS: FactorKey[] = ['entry_grade', 'trend_grade', 'pivot_grade', 'warn_grade', 'signal', 'stable_turn', 'market_regime']

const cache = new Map<string, { expiresAt: number; data: AdaptiveStrategyInsights }>()

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeFactorValue(value: string | null | undefined): string {
  return String(value || '').trim().toUpperCase()
}

function factorName(key: FactorKey): string {
  if (key === 'entry_grade') return '진입'
  if (key === 'trend_grade') return '추세'
  if (key === 'pivot_grade') return '세력'
  if (key === 'warn_grade') return '경고'
  if (key === 'signal') return '신호'
  if (key === 'stable_turn') return '세력턴'
  return '국면'
}

function factorLabel(key: FactorKey, value: string): string {
  const normalized = normalizeFactorValue(value)
  if (!normalized) return `${factorName(key)} 미정`
  return `${factorName(key)} ${normalized}`
}

function buildCacheKey(): string {
  return 'adaptive:pullback:20:3'
}

function calcWeight(acc: FactorAccumulator): number {
  if (acc.count < 4) return 0
  const avgReturnPct = acc.returnSum / acc.count
  const winRatePct = (acc.wins / acc.count) * 100
  const confidence = Math.min(1, acc.count / 12)
  return round1(clamp((avgReturnPct * 2.4 + (winRatePct - 50) * 0.16) * confidence, -10, 10))
}

async function getRecentTradeDates(supabase: SupabaseClient, limit: number): Promise<string[]> {
  const { data, error } = await supabase
    .from('pullback_signals')
    .select('trade_date')
    .order('trade_date', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  const uniqueDates = Array.from(
    new Set(
      (data ?? [])
        .map((row: unknown) => String((row as { trade_date?: string }).trade_date || ''))
        .filter((value: string): value is string => Boolean(value))
    )
  )
  return uniqueDates.slice(0, limit)
}

async function getHistoricalPullbackRows(supabase: SupabaseClient, tradeDates: string[]): Promise<PullbackHistoryRow[]> {
  if (tradeDates.length === 0) return []

  const { data: pullbackData, error: pullbackError } = await supabase
    .from('pullback_signals')
    .select('trade_date,code,entry_grade,trend_grade,pivot_grade,warn_grade')
    .in('trade_date', tradeDates)
    .in('entry_grade', ['A', 'B'])
    .neq('warn_grade', 'SELL')

  if (pullbackError) throw new Error(pullbackError.message)

  const rows: PullbackHistoryRow[] = (pullbackData ?? []).map((row: unknown) => ({
    trade_date: String((row as PullbackHistoryRow).trade_date || ''),
    code: String((row as PullbackHistoryRow).code || ''),
    entry_grade: (row as PullbackHistoryRow).entry_grade ?? null,
    trend_grade: (row as PullbackHistoryRow).trend_grade ?? null,
    pivot_grade: (row as PullbackHistoryRow).pivot_grade ?? null,
    warn_grade: (row as PullbackHistoryRow).warn_grade ?? null,
    signal: null as string | null,
    stable_turn: null as string | null,
    market_regime: null as string | null,
  }))

  const codeSet = Array.from(new Set(rows.map((row) => row.code).filter(Boolean)))
  if (codeSet.length === 0) return rows

  // 각 코드별 최신 scores 데이터 조회
  const { data: scoresData } = await supabase
    .from('scores')
    .select('code,signal,stable_turn')
    .in('code', codeSet)
    .order('trade_date', { ascending: false })
    .limit(Math.max(50, codeSet.length))

  const scoresByCode = new Map<string, { signal: string | null; stable_turn: string | null }>()
  for (const scoreRow of scoresData ?? []) {
    const code = String((scoreRow as { code?: string }).code || '')
    if (code && !scoresByCode.has(code)) {
      scoresByCode.set(code, {
        signal: (scoreRow as { signal?: string }).signal ?? null,
        stable_turn: (scoreRow as { stable_turn?: string }).stable_turn ?? null,
      })
    }
  }

  // 각 코드별 최신 market_regime 조회 (decisions 테이블에서)
  const { data: decisionData } = await supabase
    .from('decisions')
    .select('code,market_regime')
    .in('code', codeSet)
    .order('created_at', { ascending: false })
    .limit(Math.max(50, codeSet.length))

  const regimeByCode = new Map<string, string>()
  for (const decRow of decisionData ?? []) {
    const code = String((decRow as { code?: string }).code || '')
    const regime = (decRow as { market_regime?: string }).market_regime ?? null
    if (code && regime && !regimeByCode.has(code)) {
      regimeByCode.set(code, regime)
    }
  }

  // rows에 signal, stable_turn, market_regime 병합
  return rows.map((row) => {
    const scores = scoresByCode.get(row.code)
    const regime = regimeByCode.get(row.code)
    return {
      ...row,
      signal: scores?.signal ?? null,
      stable_turn: scores?.stable_turn ?? null,
      market_regime: regime ?? null,
    }
  })
}

async function getPriceRows(
  supabase: SupabaseClient,
  codes: string[],
  startDate: string,
  endDate: string
): Promise<PriceRow[]> {
  if (codes.length === 0) return []

  for (const tableName of PRICE_TABLES) {
    const { data, error } = await supabase
      .from(tableName)
      .select('code,date,close')
      .in('code', codes)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })

    if (error) continue
    if (!Array.isArray(data) || data.length === 0) continue

    return data
      .map((row) => ({
        code: String((row as { code?: string }).code || ''),
        date: String((row as { date?: string }).date || ''),
        close: Number((row as { close?: number }).close || 0),
      }))
      .filter((row) => row.code && row.date && Number.isFinite(row.close) && row.close > 0)
  }

  return []
}

function getForwardReturnPct(series: PriceRow[], tradeDate: string, horizonBars: number): number | null {
  const anchorIndex = series.findIndex((row) => row.date >= tradeDate)
  if (anchorIndex < 0) return null
  const futureIndex = anchorIndex + horizonBars
  if (futureIndex >= series.length) return null

  const entryPrice = Number(series[anchorIndex]?.close || 0)
  const futurePrice = Number(series[futureIndex]?.close || 0)
  if (!(entryPrice > 0) || !(futurePrice > 0)) return null

  return ((futurePrice - entryPrice) / entryPrice) * 100
}

export async function getAdaptiveStrategyInsights(supabase: SupabaseClient): Promise<AdaptiveStrategyInsights> {
  const cacheKey = buildCacheKey()
  const cached = cache.get(cacheKey)
  if (cached && Date.now() <= cached.expiresAt) return cached.data

  const tradeDates = await getRecentTradeDates(supabase, 20)
  const latestTradeDate = tradeDates[0] ?? null
  const historicalRows = await getHistoricalPullbackRows(supabase, tradeDates)
  const codeSet = Array.from(new Set(historicalRows.map((row) => row.code).filter(Boolean)))
  const oldestTradeDate = tradeDates[tradeDates.length - 1] ?? latestTradeDate ?? ''
  const priceRows = await getPriceRows(supabase, codeSet, oldestTradeDate, '2999-12-31')

  const priceMap = new Map<string, PriceRow[]>()
  for (const row of priceRows) {
    if (!priceMap.has(row.code)) priceMap.set(row.code, [])
    priceMap.get(row.code)!.push(row)
  }

  const globalAcc: FactorAccumulator = { count: 0, wins: 0, returnSum: 0 }
  const factorAcc = new Map<string, FactorAccumulator>()
  const horizonBars = 3

  for (const row of historicalRows) {
    const series = priceMap.get(row.code)
    if (!series || series.length === 0) continue
    const forwardReturnPct = getForwardReturnPct(series, row.trade_date, horizonBars)
    if (forwardReturnPct == null) continue

    globalAcc.count += 1
    globalAcc.returnSum += forwardReturnPct
    if (forwardReturnPct > 0) globalAcc.wins += 1

    for (const factorKey of FACTOR_KEYS) {
      const value = normalizeFactorValue(row[factorKey])
      if (!value) continue
      const mapKey = `${factorKey}:${value}`
      const acc = factorAcc.get(mapKey) || { count: 0, wins: 0, returnSum: 0 }
      acc.count += 1
      acc.returnSum += forwardReturnPct
      if (forwardReturnPct > 0) acc.wins += 1
      factorAcc.set(mapKey, acc)
    }
  }

  const factorWeights: Partial<Record<FactorKey, Record<string, number>>> = {}
  const factorStats: AdaptiveFactorStat[] = []

  for (const [mapKey, acc] of factorAcc.entries()) {
    const [rawKey, rawValue] = mapKey.split(':') as [FactorKey, string]
    const avgForwardReturnPct = acc.count > 0 ? acc.returnSum / acc.count : 0
    const winRatePct = acc.count > 0 ? (acc.wins / acc.count) * 100 : 0
    const weight = calcWeight(acc)
    if (!factorWeights[rawKey]) factorWeights[rawKey] = {}
    factorWeights[rawKey]![rawValue] = weight
    factorStats.push({
      key: rawKey,
      factor: rawValue,
      label: factorLabel(rawKey, rawValue),
      sampleCount: acc.count,
      winRatePct: round1(winRatePct),
      avgForwardReturnPct: round1(avgForwardReturnPct),
      weight,
    })
  }

  factorStats.sort((a, b) => b.weight - a.weight || b.avgForwardReturnPct - a.avgForwardReturnPct)

  const topPositiveFactors = factorStats.filter((item) => item.weight > 0.3).slice(0, 5)
  const topNegativeFactors = [...factorStats]
    .filter((item) => item.weight < -0.3)
    .sort((a, b) => a.weight - b.weight || a.avgForwardReturnPct - b.avgForwardReturnPct)
    .slice(0, 5)

  const positiveLabels = topPositiveFactors.slice(0, 3).map((item) => item.label)
  const todayBiasSummary = positiveLabels.length > 0 ? `${positiveLabels.join(' · ')} 우위` : '최근 우위 패턴 없음'

  const data: AdaptiveStrategyInsights = {
    latestTradeDate,
    horizonBars,
    sampleCount: globalAcc.count,
    baseHitRatePct: globalAcc.count > 0 ? round1((globalAcc.wins / globalAcc.count) * 100) : 0,
    baseAvgReturnPct: globalAcc.count > 0 ? round1(globalAcc.returnSum / globalAcc.count) : 0,
    strengthScore: clamp(Math.round(topPositiveFactors.reduce((sum, item) => sum + Math.max(0, item.weight), 0) * 6), 0, 100),
    todayBiasSummary,
    topPositiveFactors,
    topNegativeFactors,
    factorWeights,
  }

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data })
  return data
}

export function applyAdaptiveOverlayToPullbackCandidate(
  row: Partial<Record<FactorKey, string | null | undefined>>,
  insights: AdaptiveStrategyInsights,
  maxReasons = 3
): AdaptiveOverlay {
  const contributions: Array<{ label: string; weight: number }> = []

  for (const factorKey of FACTOR_KEYS) {
    const rawValue = normalizeFactorValue(row[factorKey])
    if (!rawValue) continue
    const weight = insights.factorWeights[factorKey]?.[rawValue] ?? 0
    if (Math.abs(weight) < 0.1) continue
    contributions.push({
      label: factorLabel(factorKey, rawValue),
      weight,
    })
  }

  contributions.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))

  return {
    adjustment: round1(contributions.reduce((sum, item) => sum + item.weight, 0)),
    reasons: contributions.slice(0, maxReasons).map((item) => `${item.label} ${item.weight > 0 ? '+' : ''}${item.weight.toFixed(1)}`),
  }
}