import type { DailyCandidateForecast } from './marketInsightService'

export type CandidateReportTopic = '추천' | '확신추천' | '공개추천'

function edgeScore(item: DailyCandidateForecast): number {
  return Number(item.expectedUpsidePct || 0) - Number(item.expectedDrawdownPct || 0)
}

function dedupeByCode(items: DailyCandidateForecast[]): DailyCandidateForecast[] {
  const seen = new Set<string>()
  const out: DailyCandidateForecast[] = []
  for (const item of items) {
    const code = String(item.code || '')
    if (!code || seen.has(code)) continue
    seen.add(code)
    out.push(item)
  }
  return out
}

function pickDiversified(
  sorted: DailyCandidateForecast[],
  limit: number,
  maxPerStrategy: number,
): DailyCandidateForecast[] {
  const picked: DailyCandidateForecast[] = []
  const perStrategy = new Map<string, number>()

  for (const item of sorted) {
    if (picked.length >= limit) break
    const strategy = String(item.strategyLabel || '기타')
    const used = perStrategy.get(strategy) || 0
    if (used >= maxPerStrategy) continue
    picked.push(item)
    perStrategy.set(strategy, used + 1)
  }

  if (picked.length >= limit) return picked

  const pickedCodes = new Set(picked.map((item) => item.code))
  for (const item of sorted) {
    if (picked.length >= limit) break
    if (pickedCodes.has(item.code)) continue
    picked.push(item)
    pickedCodes.add(item.code)
  }

  return picked
}

function sortForDaily(items: DailyCandidateForecast[]): DailyCandidateForecast[] {
  return [...items].sort((a, b) => {
    const aScore =
      a.confidencePct * 0.45 +
      a.scoreComponents.momentum * 0.2 +
      a.scoreComponents.value * 0.15 +
      a.scoreComponents.safety * 0.2 +
      edgeScore(a) * 1.2
    const bScore =
      b.confidencePct * 0.45 +
      b.scoreComponents.momentum * 0.2 +
      b.scoreComponents.value * 0.15 +
      b.scoreComponents.safety * 0.2 +
      edgeScore(b) * 1.2
    return bScore - aScore
  })
}

function sortForConviction(items: DailyCandidateForecast[]): DailyCandidateForecast[] {
  return [...items].sort((a, b) => {
    if (b.confidencePct !== a.confidencePct) return b.confidencePct - a.confidencePct
    const bEdge = edgeScore(b)
    const aEdge = edgeScore(a)
    if (bEdge !== aEdge) return bEdge - aEdge
    return b.scoreComponents.safety - a.scoreComponents.safety
  })
}

function sortForPublic(items: DailyCandidateForecast[]): DailyCandidateForecast[] {
  return [...items].sort((a, b) => {
    if (b.scoreComponents.safety !== a.scoreComponents.safety) {
      return b.scoreComponents.safety - a.scoreComponents.safety
    }
    if (b.confidencePct !== a.confidencePct) return b.confidencePct - a.confidencePct
    if (a.expectedDrawdownPct !== b.expectedDrawdownPct) return a.expectedDrawdownPct - b.expectedDrawdownPct
    return b.expectedUpsidePct - a.expectedUpsidePct
  })
}

export function selectForecastsForTopic(
  topic: CandidateReportTopic,
  forecasts: DailyCandidateForecast[],
): DailyCandidateForecast[] {
  const base = dedupeByCode(forecasts || [])
  if (!base.length) return []

  if (topic === '확신추천') {
    const filtered = base.filter(
      (item) => item.confidencePct >= 64 && edgeScore(item) >= 3 && item.expectedDrawdownPct <= 8,
    )
    const relaxed = base.filter(
      (item) => item.confidencePct >= 58 && edgeScore(item) >= 1.5 && item.expectedDrawdownPct <= 9,
    )
    const source = filtered.length >= 3 ? filtered : (relaxed.length >= 3 ? relaxed : base)
    const ranked = sortForConviction(source)
    return pickDiversified(ranked, 5, 1)
  }

  if (topic === '공개추천') {
    const filtered = base.filter(
      (item) => item.scoreComponents.safety >= 55 && item.expectedDrawdownPct <= 7.5,
    )
    const relaxed = base.filter(
      (item) => item.scoreComponents.safety >= 48 && item.expectedDrawdownPct <= 9,
    )
    const source = filtered.length >= 4 ? filtered : (relaxed.length >= 4 ? relaxed : base)
    const ranked = sortForPublic(source)
    return pickDiversified(ranked, 6, 1)
  }

  const ranked = sortForDaily(base)
  return pickDiversified(ranked, 8, 3)
}
