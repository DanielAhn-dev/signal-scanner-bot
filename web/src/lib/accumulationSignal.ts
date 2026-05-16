import type { OhlcvCandle } from './types'

export type AccumulationStage = 'none' | 'lead' | 'breakout' | 'extended'

export type AccumulationSignal = {
  stage: AccumulationStage
  score: number
  baseLow: number | null
  baseHigh: number | null
  baseRangePct: number | null
  breakoutDate: string | null
  reasons: string[]
}

export type LeadAccumulationSignal = {
  stage: 'none' | 'lead' | 'breakout'
  score: number
  reasons: string[]
}

type ScanCandidateLike = {
  entry_grade?: string | null
  trend_grade?: string | null
  dist_grade?: string | null
  pivot_grade?: string | null
  warn_grade?: string | null
  warn_score?: number | null
  dist_pct?: number | null
  entry_score?: number | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function average(values: number[]): number | null {
  const filtered = values.filter((value) => Number.isFinite(value))
  if (filtered.length === 0) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

function gradeScore(grade: string | null | undefined): number {
  const value = String(grade || '').trim().toUpperCase()
  if (value === 'A') return 5
  if (value === 'B') return 4
  if (value === 'C') return 3
  if (value === 'D') return 2
  if (value === 'E') return 1
  return 0
}

function computeSma(candles: OhlcvCandle[], period: number): number | null {
  if (period <= 0 || candles.length < period) return null
  const window = candles.slice(-period)
  const values = window.map((c) => Number(c.close)).filter((value) => Number.isFinite(value) && value > 0)
  return average(values)
}

function computeEma(candles: OhlcvCandle[], period: number): number | null {
  if (period <= 0 || candles.length < period) return null
  const closes = candles.map((c) => Number(c.close)).filter((value) => Number.isFinite(value) && value > 0)
  if (closes.length < period) return null

  const k = 2 / (period + 1)
  let ema = closes.slice(0, period).reduce((sum, value) => sum + value, 0) / period
  for (let i = period; i < closes.length; i += 1) {
    ema = closes[i] * k + ema * (1 - k)
  }
  return ema
}

export function evaluateAccumulationSignal(candles: OhlcvCandle[]): AccumulationSignal {
  const sorted = [...candles]
    .filter((c) => Number(c.close) > 0 && Number(c.high) > 0 && Number(c.low) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))

  if (sorted.length < 60) {
    return {
      stage: 'none',
      score: 0,
      baseLow: null,
      baseHigh: null,
      baseRangePct: null,
      breakoutDate: null,
      reasons: [],
    }
  }

  const latest = sorted[sorted.length - 1]
  const baseWindowSize = 20
  const baseWindow = sorted.slice(-baseWindowSize)
  const priorWindow = sorted.slice(-baseWindowSize - 20, -baseWindowSize)
  const baseHigh = Math.max(...baseWindow.map((c) => Number(c.high)))
  const baseLow = Math.min(...baseWindow.map((c) => Number(c.low)))
  const baseRangePct = baseLow > 0 ? ((baseHigh - baseLow) / baseLow) * 100 : null
  const baseVol = average(baseWindow.map((c) => Number(c.volume) || 0))
  const priorVol = average(priorWindow.map((c) => Number(c.volume) || 0))
  const ema21 = computeEma(sorted, 21)
  const sma60 = computeSma(sorted, 60)
  const close = Number(latest.close)
  const volume = Number(latest.volume) || 0

  const tightBase = baseRangePct != null && baseRangePct <= 18
  const volumeDryUp = baseVol != null && priorVol != null && priorVol > 0 ? baseVol <= priorVol * 0.9 : false
  const trendOk = ema21 != null && sma60 != null ? close >= ema21 && ema21 >= sma60 : false
  const breakout = close >= baseHigh * 1.02 && baseVol != null && priorVol != null ? volume >= priorVol * 1.2 : false
  const nearBreakout = close >= baseHigh * 0.985 && close <= baseHigh * 1.05
  const extended = close >= baseHigh * 1.12

  let score = 0
  const reasons: string[] = []

  if (tightBase) {
    score += 20
    reasons.push(`기반 변동폭 ${baseRangePct?.toFixed(1)}%`)
  } else if (baseRangePct != null && baseRangePct <= 25) {
    score += 10
  }

  if (volumeDryUp) {
    score += 20
    reasons.push('거래량 수축 확인')
  }

  if (trendOk) {
    score += 20
    reasons.push('EMA21/SMA60 상향 정렬')
  }

  if (breakout) {
    score += 25
    reasons.push('기반 상단 돌파 + 거래량 확장')
  } else if (nearBreakout) {
    score += 10
    reasons.push('기반 상단 인접')
  }

  if (extended) {
    score -= 10
  }

  score = clamp(score, 0, 100)

  let stage: AccumulationStage = 'none'
  if (score >= 75 && breakout && trendOk) {
    stage = 'breakout'
  } else if (score >= 55 && (breakout || (tightBase && volumeDryUp && nearBreakout))) {
    stage = 'lead'
  } else if (score >= 40 && tightBase && trendOk) {
    stage = 'extended'
  }

  return {
    stage,
    score,
    baseLow: Number.isFinite(baseLow) ? baseLow : null,
    baseHigh: Number.isFinite(baseHigh) ? baseHigh : null,
    baseRangePct: baseRangePct != null && Number.isFinite(baseRangePct) ? baseRangePct : null,
    breakoutDate: stage === 'none' ? null : String(latest.date || null),
    reasons,
  }
}

export function scoreLeadAccumulationCandidate(item: ScanCandidateLike): LeadAccumulationSignal {
  const entryGrade = gradeScore(item.entry_grade)
  const trendGrade = gradeScore(item.trend_grade)
  const distGrade = gradeScore(item.dist_grade)
  const pivotGrade = gradeScore(item.pivot_grade)
  const warnGrade = String(item.warn_grade || '').trim().toUpperCase()
  const warnScore = Number(item.warn_score)
  const distPct = Number(item.dist_pct)
  const entryScore = Number(item.entry_score)

  let score = 0
  const reasons: string[] = []

  if (distGrade >= 4) {
    score += 18
    reasons.push('매집 등급 우수')
  } else if (distGrade === 3) {
    score += 10
  }

  if (pivotGrade >= 4) {
    score += 18
    reasons.push('세력선 등급 우수')
  } else if (pivotGrade === 3) {
    score += 10
  }

  if (trendGrade >= 4) {
    score += 14
    reasons.push('추세 양호')
  } else if (trendGrade === 3) {
    score += 8
  }

  if (warnGrade === 'SAFE' || warnGrade === 'WATCH' || warnGrade === '') {
    score += 12
  }

  if (Number.isFinite(warnScore)) {
    if (warnScore <= 2) score += 8
    else if (warnScore <= 4) score += 4
    else score -= 6
  }

  if (Number.isFinite(distPct)) {
    if (distPct <= 4) score += 10
    else if (distPct <= 8) score += 6
    else if (distPct <= 12) score += 2
    else score -= 6
  }

  if (entryGrade === 4 || entryGrade === 3) {
    score += 6
    reasons.push('진입 전환 가능')
  } else if (entryGrade === 5) {
    score -= 5
  }

  if (Number.isFinite(entryScore)) {
    if (entryScore >= 2.5 && entryScore <= 3.9) score += 6
    else if (entryScore > 4.2) score -= 4
  }

  score = clamp(score, 0, 100)

  let stage: LeadAccumulationSignal['stage'] = 'none'
  if (score >= 75) stage = 'breakout'
  else if (score >= 55) stage = 'lead'

  return {
    stage,
    score,
    reasons,
  }
}