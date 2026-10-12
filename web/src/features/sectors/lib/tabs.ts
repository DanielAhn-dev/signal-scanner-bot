import type { Sector, Tab } from '../types'
import { toNum } from './format'

/** 외국인+기관 5일 순매수 합 */
export function flow5d(s: Sector): number {
  return (toNum(s.metrics?.flow_foreign_5d) ?? 0) + (toNum(s.metrics?.flow_inst_5d) ?? 0)
}

/** "다음 섹터" 후보: 수급 합이 플러스이거나, 오르면서 점수 40 이상 */
export function isNextCandidate(s: Sector): boolean {
  return flow5d(s) > 0 || ((s.change_rate ?? 0) > 0 && (s.score ?? 0) >= 40)
}

/** 점수 내림차순 */
export function sortByScore(all: Sector[]): Sector[] {
  return [...all].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

/** 탭별 목록. 상위 탭은 점수 55 이상(없으면 전체), 다음 탭은 수급 합 → 등락률 순 */
export function rankSectors(all: Sector[], tab: Tab) {
  const sorted = sortByScore(all)
  const promising = sorted.filter((s) => (s.score ?? 0) >= 55)
  const next = [...all]
    .filter(isNextCandidate)
    .sort((a, b) => {
      const flowDiff = flow5d(b) - flow5d(a)
      if (flowDiff !== 0) return flowDiff
      return (b.change_rate ?? 0) - (a.change_rate ?? 0)
    })
  const displayed = tab === 'promising' ? (promising.length > 0 ? promising : sorted) : next
  return { sorted, promising, next, displayed }
}

/** 섹터 갱신 시각 중 가장 최근 값(ISO), 없으면 null */
export function latestSectorUpdate(all: Sector[]): string | null {
  const values = all
    .map((sector) => sector.updated_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
  if (values.length === 0) return null
  return new Date(Math.max(...values)).toISOString()
}
