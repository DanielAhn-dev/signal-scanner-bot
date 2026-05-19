import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

type ScoreRow = {
  code: string
  asof: string
  total_score?: number | null
  signal?: string | null
  factors?: Record<string, unknown> | null
}

type PriceRow = {
  code: string
  tradeDate: string
  close: number
}

type EventRow = {
  code: string
  name?: string
  asof: string
  totalScore: number
  signal: string
  rsi14: number | null
  forwardReturnPct: number
}

type FeatureStat = {
  key: string
  label: string
  baselineRatePct: number
  riserRatePct: number
  liftPct: number
  supportPct: number
}

type RuleCandidate = {
  key: string
  label: string
  supportPct: number
  liftPct: number
  precisionPct: number
  matchedEvents: number
  riserMatches: number
  filter?: {
    scoreMin?: number
    buyOnly?: boolean
    rsiMin?: number
    rsiMax?: number
  }
}

const SUPPORTED_HORIZONS = [20, 40, 60, 90, 120] as const

function parseNum(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(parseNum(value, fallback))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeCode(value: unknown): string {
  const s = String(value || '').trim()
  return s
}

function normalizeDate(value: unknown): string {
  const s = String(value || '').trim()
  if (!s) return ''
  return s.slice(0, 10)
}

function shiftDate(days: number): string {
  const now = new Date()
  const d = new Date(now.getTime() - days * 86_400_000)
  return d.toISOString().slice(0, 10)
}

function splitArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

function asRsi14(factors: Record<string, unknown> | null | undefined): number | null {
  const n = Number(factors?.rsi14)
  if (!Number.isFinite(n)) return null
  return n
}

async function fetchScoreRows(supabase: any, fromDate: string, maxRows: number): Promise<ScoreRow[]> {
  const out: ScoreRow[] = []
  const pageSize = 1000

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await supabase
      .from('scores')
      .select('code,asof,total_score,signal,factors')
      .gte('asof', fromDate)
      .order('asof', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(`scores 조회 실패: ${error.message}`)

    const rows = (data ?? []) as ScoreRow[]
    if (rows.length === 0) break
    out.push(...rows)
    if (rows.length < pageSize) break
  }

  return out.slice(0, maxRows)
}

async function fetchPriceRows(supabase: any, codes: string[], fromDate: string): Promise<PriceRow[]> {
  const chunks = splitArray(codes, 100)
  const CONCURRENCY = 10
  const out: PriceRow[] = []

  // stock_daily만 사용 (무료 플랜 쿼리 수 절약)
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map((chunk) =>
        supabase
          .from('stock_daily')
          .select('ticker,date,close')
          .in('ticker', chunk)
          .gte('date', fromDate)
          .order('date', { ascending: true }),
      ),
    )
    for (const { data, error } of results) {
      if (error) throw new Error(`stock_daily 조회 실패: ${error.message}`)
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const code = normalizeCode(row.ticker)
        const tradeDate = normalizeDate(row.date)
        const close = parseNum(row.close, 0)
        if (code && tradeDate && close > 0) out.push({ code, tradeDate, close })
      }
    }
  }

  return out
}

function buildPriceIndex(rows: PriceRow[]): Map<string, { dates: string[]; closes: number[]; indexByDate: Map<string, number> }> {
  const byCode = new Map<string, Map<string, number>>()

  for (const row of rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, new Map<string, number>())
    byCode.get(row.code)!.set(row.tradeDate, row.close)
  }

  const out = new Map<string, { dates: string[]; closes: number[]; indexByDate: Map<string, number> }>()
  for (const [code, dateMap] of byCode) {
    const dates = Array.from(dateMap.keys()).sort((a, b) => a.localeCompare(b))
    const closes = dates.map((d) => Number(dateMap.get(d) || 0))
    const indexByDate = new Map<string, number>()
    dates.forEach((d, i) => indexByDate.set(d, i))
    out.set(code, { dates, closes, indexByDate })
  }

  return out
}

// 무료 플랜 기준: 10s 제한, maxRows 최대 5000
function parseParams(req: VercelRequest) {
  const horizonBars = parsePositiveInt(req.query.horizon, 20, 5, 180)
  const lookbackDays = parsePositiveInt(req.query.lookbackDays, 90, 60, 365)
  const rallyThresholdPct = parseNum(req.query.rallyPct, 20)
  const topN = parsePositiveInt(req.query.topN, 30, 5, 100)
  const maxRows = parsePositiveInt(req.query.maxRows, 3000, 500, 5000)
  return { horizonBars, lookbackDays, rallyThresholdPct, topN, maxRows }
}

function buildLabelableEvents(
  scoreRows: Array<{ code: string; asof: string; totalScore: number; signal: string; rsi14: number | null }>,
  priceIndex: Map<string, { dates: string[]; closes: number[]; indexByDate: Map<string, number> }>,
  horizonBars: number,
): EventRow[] {
  const labelableEvents: EventRow[] = []

  for (const row of scoreRows) {
    const idx = priceIndex.get(row.code)
    if (!idx) continue
    const anchorIndex = idx.indexByDate.get(row.asof)
    if (anchorIndex == null) continue
    const targetIndex = anchorIndex + horizonBars
    if (targetIndex >= idx.closes.length) continue

    const entry = idx.closes[anchorIndex]
    const exit = idx.closes[targetIndex]
    if (!(entry > 0 && exit > 0)) continue

    const forwardReturnPct = Number((((exit - entry) / entry) * 100).toFixed(2))
    labelableEvents.push({
      code: row.code,
      asof: row.asof,
      totalScore: Number(row.totalScore.toFixed(2)),
      signal: row.signal,
      rsi14: row.rsi14,
      forwardReturnPct,
    })
  }

  return labelableEvents
}

function isBuyFamily(signal: string): boolean {
  const u = String(signal || '').toUpperCase()
  if (!u) return false
  return ['BUY', 'STRONG_BUY', 'ACCUMULATE', '매수'].some((token) => u.includes(token))
}

function rate(count: number, total: number): number {
  if (!(total > 0)) return 0
  return (count / total) * 100
}

function createFeatureStats(labelableEvents: EventRow[], riserUniverse: EventRow[]): FeatureStat[] {
  const baselineCount = labelableEvents.length
  const riserCount = riserUniverse.length

  const features: Array<{ key: string; label: string; test: (row: EventRow) => boolean }> = [
    { key: 'score70', label: '점수 ≥ 70', test: (row) => row.totalScore >= 70 },
    { key: 'score65', label: '점수 ≥ 65', test: (row) => row.totalScore >= 65 },
    { key: 'score60', label: '점수 ≥ 60', test: (row) => row.totalScore >= 60 },
    { key: 'score55', label: '점수 ≥ 55', test: (row) => row.totalScore >= 55 },
    { key: 'buyFamily', label: 'BUY 계열 시그널', test: (row) => isBuyFamily(row.signal) },
    {
      key: 'rsi45to65',
      label: 'RSI 45~65',
      test: (row) => row.rsi14 != null && row.rsi14 >= 45 && row.rsi14 <= 65,
    },
    {
      key: 'rsi40to70',
      label: 'RSI 40~70',
      test: (row) => row.rsi14 != null && row.rsi14 >= 40 && row.rsi14 <= 70,
    },
    {
      key: 'rsi30to80',
      label: 'RSI 30~80',
      test: (row) => row.rsi14 != null && row.rsi14 >= 30 && row.rsi14 <= 80,
    },
  ]

  return features.map((feature) => {
    const baselineMatches = labelableEvents.filter(feature.test).length
    const riserMatches = riserUniverse.filter(feature.test).length
    const baselineRatePct = rate(baselineMatches, baselineCount)
    const riserRatePct = rate(riserMatches, riserCount)
    return {
      key: feature.key,
      label: feature.label,
      baselineRatePct: Number(baselineRatePct.toFixed(1)),
      riserRatePct: Number(riserRatePct.toFixed(1)),
      liftPct: Number((riserRatePct - baselineRatePct).toFixed(1)),
      supportPct: Number(riserRatePct.toFixed(1)),
    }
  })
}

function createRuleCandidates(labelableEvents: EventRow[], riserUniverse: EventRow[]): RuleCandidate[] {
  const baselineCount = labelableEvents.length
  const riserCount = riserUniverse.length
  if (!(baselineCount > 0 && riserCount > 0)) return []

  const rules: Array<{ key: string; label: string; test: (row: EventRow) => boolean; filter?: { scoreMin?: number; buyOnly?: boolean; rsiMin?: number; rsiMax?: number } }> = [
    // Precision 중심: score 기반 규칙
    {
      key: 'rule_score70_buy',
      label: '점수≥70 + BUY계열',
      test: (row) => row.totalScore >= 70 && isBuyFamily(row.signal),
      filter: { scoreMin: 70, buyOnly: true },
    },
    {
      key: 'rule_score65_buy',
      label: '점수≥65 + BUY계열',
      test: (row) => row.totalScore >= 65 && isBuyFamily(row.signal),
      filter: { scoreMin: 65, buyOnly: true },
    },
    {
      key: 'rule_score60_buy',
      label: '점수≥60 + BUY계열',
      test: (row) => row.totalScore >= 60 && isBuyFamily(row.signal),
      filter: { scoreMin: 60, buyOnly: true },
    },
    {
      key: 'rule_score55_buy',
      label: '점수≥55 + BUY계열',
      test: (row) => row.totalScore >= 55 && isBuyFamily(row.signal),
      filter: { scoreMin: 55, buyOnly: true },
    },
    // Support 중심: RSI 단독 규칙 (데이터 풍부)
    {
      key: 'rule_rsi30_80',
      label: 'RSI 30~80 (광범위)',
      test: (row) => row.rsi14 != null && row.rsi14 >= 30 && row.rsi14 <= 80,
      filter: { rsiMin: 30, rsiMax: 80 },
    },
    {
      key: 'rule_rsi40_70',
      label: 'RSI 40~70',
      test: (row) => row.rsi14 != null && row.rsi14 >= 40 && row.rsi14 <= 70,
      filter: { rsiMin: 40, rsiMax: 70 },
    },
    {
      key: 'rule_rsi45_65',
      label: 'RSI 45~65 (정중간)',
      test: (row) => row.rsi14 != null && row.rsi14 >= 45 && row.rsi14 <= 65,
      filter: { rsiMin: 45, rsiMax: 65 },
    },
    // 조합: score + RSI
    {
      key: 'rule_score60_rsi40_70',
      label: '점수≥60 + RSI 40~70',
      test: (row) => row.totalScore >= 60 && row.rsi14 != null && row.rsi14 >= 40 && row.rsi14 <= 70,
      filter: { scoreMin: 60, rsiMin: 40, rsiMax: 70 },
    },
    {
      key: 'rule_score55_rsi40_70',
      label: '점수≥55 + RSI 40~70',
      test: (row) => row.totalScore >= 55 && row.rsi14 != null && row.rsi14 >= 40 && row.rsi14 <= 70,
      filter: { scoreMin: 55, rsiMin: 40, rsiMax: 70 },
    },
    {
      key: 'rule_buy_rsi45_65',
      label: 'BUY계열 + RSI 45~65',
      test: (row) => isBuyFamily(row.signal) && row.rsi14 != null && row.rsi14 >= 45 && row.rsi14 <= 65,
      filter: { buyOnly: true, rsiMin: 45, rsiMax: 65 },
    },
    {
      key: 'rule_buy_rsi40_70',
      label: 'BUY계열 + RSI 40~70',
      test: (row) => isBuyFamily(row.signal) && row.rsi14 != null && row.rsi14 >= 40 && row.rsi14 <= 70,
      filter: { buyOnly: true, rsiMin: 40, rsiMax: 70 },
    },
    // 3중 조합
    {
      key: 'rule_score65_buy_rsi40_70',
      label: '점수≥65 + BUY계열 + RSI 40~70',
      test: (row) =>
        row.totalScore >= 65 &&
        isBuyFamily(row.signal) &&
        row.rsi14 != null &&
        row.rsi14 >= 40 &&
        row.rsi14 <= 70,
      filter: { scoreMin: 65, buyOnly: true, rsiMin: 40, rsiMax: 70 },
    },
    {
      key: 'rule_score70_buy_rsi45_65',
      label: '점수≥70 + BUY계열 + RSI 45~65',
      test: (row) =>
        row.totalScore >= 70 &&
        isBuyFamily(row.signal) &&
        row.rsi14 != null &&
        row.rsi14 >= 45 &&
        row.rsi14 <= 65,
      filter: { scoreMin: 70, buyOnly: true, rsiMin: 45, rsiMax: 65 },
    },
  ]

  const minimumMatches = Math.max(5, Math.floor(baselineCount * 0.01))
  const candidates = rules
    .map((rule) => {
      const matchedEvents = labelableEvents.filter(rule.test).length
      const riserMatches = riserUniverse.filter(rule.test).length
      const baselineRatePct = rate(matchedEvents, baselineCount)
      const supportPct = rate(riserMatches, riserCount)
      const liftPct = supportPct - baselineRatePct
      const precisionPct = matchedEvents > 0 ? rate(riserMatches, matchedEvents) : 0
      return {
        key: rule.key,
        label: rule.label,
        supportPct,
        liftPct,
        precisionPct,
        matchedEvents,
        riserMatches,
      }
    })
    .filter((row) => row.matchedEvents >= minimumMatches)
    .sort((a, b) => {
      // Precision(실제 적중률)을 핵심(60%), support(25%), lift*confidence(15%)로 재정렬
      const confA = Math.sqrt(Math.min(a.matchedEvents, 100) / 100) // 샘플 크기 신뢰도
      const confB = Math.sqrt(Math.min(b.matchedEvents, 100) / 100)
      const scoreA = a.precisionPct * 0.6 + a.supportPct * 0.25 + a.liftPct * 0.15 * confA
      const scoreB = b.precisionPct * 0.6 + b.supportPct * 0.25 + b.liftPct * 0.15 * confB
      return scoreB - scoreA
    })
    .slice(0, 5)

  const ruleMap = new Map(rules.map((r) => [r.key, r.filter]))

  return candidates.map((row) => ({
    key: row.key,
    label: row.label,
    supportPct: Number(row.supportPct.toFixed(1)),
    liftPct: Number(row.liftPct.toFixed(1)),
    precisionPct: Number(row.precisionPct.toFixed(1)),
    matchedEvents: row.matchedEvents,
    riserMatches: row.riserMatches,
    filter: ruleMap.get(row.key),
  }))
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
      'https://signal-scanner-web.vercel.app,https://stocksweb-seven.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const isTrustedOrigin = !!origin && trustedOrigins.includes(origin)

  if (expectedReadKey && !isTrustedOrigin && String(readKey || '') !== expectedReadKey) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  try {
    const params = parseParams(req)
    // 120일 horizon까지 커버할 수 있도록 scoreFromDate 설정 (단일 조회로 모든 horizon 체크 가능)
    const scoreFromDate = shiftDate(params.lookbackDays + 120 + 10)
    const supabase = createClient(url, key)

    // 스코어 단일 조회 (maxRows 제한)
    const allScoreRowsRaw = await fetchScoreRows(supabase, scoreFromDate, params.maxRows)
    const allScoreRows = allScoreRowsRaw
      .map((row) => ({
        code: normalizeCode(row.code),
        asof: normalizeDate(row.asof),
        totalScore: parseNum(row.total_score, 0),
        signal: String(row.signal || '').toUpperCase(),
        rsi14: asRsi14(row.factors),
      }))
      .filter((row) => row.code && row.asof)

    // scoreRows와 availabilityScoreRows 동일 (priceIndex 구성 시 필요한 가격 있는 것만 자동 필터)
    const scoreRows = allScoreRows
    const availabilityScoreRows = allScoreRows

    // 코드 수 상한 (무료 플랜: 최대 300 종목)
    const codes = Array.from(new Set(allScoreRows.map((row) => row.code))).slice(0, 300)
    if (!codes.length) {
      return res.status(200).json({
        ok: true,
        data: {
          params,
          availableHorizons: [20, 40, 60],
          horizonAvailability: { '20': 0, '40': 0, '60': 0, '90': 0, '120': 0 },
          baseline: { labelableEvents: 0 },
          riserSummary: { riserEvents: 0, avgForwardReturnPct: 0 },
          risers: [],
          commonFeatures: {},
          featureStats: [],
          ruleCandidates: [],
        },
      })
    }

    const priceRows = await fetchPriceRows(supabase, codes, scoreFromDate)
    const priceIndex = buildPriceIndex(priceRows)

    const labelableEvents = buildLabelableEvents(scoreRows, priceIndex, params.horizonBars)
    const horizonAvailability = Object.fromEntries(
      SUPPORTED_HORIZONS.map((h) => [String(h), buildLabelableEvents(availabilityScoreRows, priceIndex, h).length]),
    ) as Record<string, number>
    const availableHorizons = SUPPORTED_HORIZONS.filter((h) => h <= 60 || (horizonAvailability[String(h)] ?? 0) > 0)

    const riserUniverse = labelableEvents
      .filter((row) => row.forwardReturnPct >= params.rallyThresholdPct)

    const risers = riserUniverse
      .sort((a, b) => b.forwardReturnPct - a.forwardReturnPct)
      .slice(0, params.topN)

    // 종목명 일괄 조회
    const riserCodes = Array.from(new Set(risers.map((r) => r.code)))
    const nameMap = new Map<string, string>()
    for (const chunk of splitArray(riserCodes, 100)) {
      const { data: stockRows } = await supabase
        .from('stocks')
        .select('code,name')
        .in('code', chunk)
      for (const row of (stockRows ?? []) as Array<{ code: string; name: string }>) {
        if (row.code && row.name) nameMap.set(row.code, row.name)
      }
    }
    const risersWithNames = risers.map((r) => ({
      ...r,
      name: nameMap.get(r.code) ?? undefined,
    }))

    const baselineCount = labelableEvents.length
    const riserCount = riserUniverse.length

    const baselineScore70 = baselineCount > 0
      ? (labelableEvents.filter((row) => row.totalScore >= 70).length / baselineCount) * 100
      : 0
    const riserScore70 = riserCount > 0
      ? (riserUniverse.filter((row) => row.totalScore >= 70).length / riserCount) * 100
      : 0

    const baselineBuySignal = baselineCount > 0
      ? (labelableEvents.filter((row) => row.signal === 'BUY' || row.signal === 'STRONG_BUY').length / baselineCount) * 100
      : 0
    const riserBuySignal = riserCount > 0
      ? (riserUniverse.filter((row) => row.signal === 'BUY' || row.signal === 'STRONG_BUY').length / riserCount) * 100
      : 0

    const rsiBand45to65 = riserCount > 0
      ? (riserUniverse.filter((row) => row.rsi14 != null && row.rsi14 >= 45 && row.rsi14 <= 65).length / riserCount) * 100
      : 0

    const avgForwardReturn = riserCount > 0
      ? riserUniverse.reduce((acc, row) => acc + row.forwardReturnPct, 0) / riserCount
      : 0

    const featureStats = createFeatureStats(labelableEvents, riserUniverse)
    const ruleCandidates = createRuleCandidates(labelableEvents, riserUniverse)

    return res.status(200).json({
      ok: true,
      data: {
        params,
        availableHorizons,
        horizonAvailability,
        baseline: {
          labelableEvents: baselineCount,
          score70RatePct: Number(baselineScore70.toFixed(1)),
          buySignalRatePct: Number(baselineBuySignal.toFixed(1)),
        },
        riserSummary: {
          riserEvents: riserCount,
          avgForwardReturnPct: Number(avgForwardReturn.toFixed(2)),
        },
        commonFeatures: {
          score70RatePct: Number(riserScore70.toFixed(1)),
          score70LiftPct: Number((riserScore70 - baselineScore70).toFixed(1)),
          buySignalRatePct: Number(riserBuySignal.toFixed(1)),
          buySignalLiftPct: Number((riserBuySignal - baselineBuySignal).toFixed(1)),
          rsi45to65RatePct: Number(rsiBand45to65.toFixed(1)),
        },
        featureStats,
        ruleCandidates,
        risers: risersWithNames,
      },
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
