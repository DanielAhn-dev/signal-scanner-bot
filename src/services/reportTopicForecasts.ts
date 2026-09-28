import type { DailyCandidateForecast } from './marketInsightService'

export type CandidateReportTopic = '추천' | '확신추천' | '공개추천'

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

// 예전엔 신뢰도·기대여지(점수로 만든 가짜 예측)로 필터·정렬했다. 이제 그 필드는 조건별 과거 20일 분포라
// 종목 순위를 매길 근거가 되지 못한다(10년 검증에서 어떤 점수·등급도 분포를 의미 있게 바꾸지 못함).
// 그래서 후보 풀의 원래 순서(분석 상위 → 눌림목 → 시장 픽)를 유지하고, 토픽별로 개수·전략 분산만 다르게 한다.
export function selectForecastsForTopic(
  topic: CandidateReportTopic,
  forecasts: DailyCandidateForecast[],
): DailyCandidateForecast[] {
  const base = dedupeByCode(forecasts || [])
  if (!base.length) return []
  if (topic === '확신추천') return pickDiversified(base, 5, 1)
  if (topic === '공개추천') return pickDiversified(base, 6, 1)
  return pickDiversified(base, 8, 3)
}
