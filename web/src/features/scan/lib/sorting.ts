import type { ScanCandidate, SortKey } from '../types'
import { computePriorityScore, gradeScore } from './candidateScore'
import { scoreLeadAccumulationCandidate } from '../../../lib/accumulationSignal'

export function toComparableValue(item: ScanCandidate, key: SortKey): string | number {
  if (key === 'priority_score') return computePriorityScore(item)
  if (key === 'lead_accumulation_score') return scoreLeadAccumulationCandidate(item).score
  if (key === 'entry_grade' || key === 'trend_grade' || key === 'dist_grade' || key === 'pivot_grade') {
    return gradeScore(item[key])
  }
  const v = item[key as keyof ScanCandidate]
  if (v == null) return ''
  if (typeof v === 'number') return v
  return String(v)
}
