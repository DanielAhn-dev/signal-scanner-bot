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

export type LeadAccumulationStage = 'none' | 'lead' | 'breakout'

export type LeadAccumulationSignal = {
  stage: LeadAccumulationStage
  score: number
  reasons: string[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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

  let stage: LeadAccumulationStage = 'none'
  if (score >= 75) stage = 'breakout'
  else if (score >= 55) stage = 'lead'

  return {
    stage,
    score,
    reasons,
  }
}