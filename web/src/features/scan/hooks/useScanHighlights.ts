import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { scoreLeadAccumulationCandidate } from '../../../lib/accumulationSignal'
import { gradeScore } from '../lib/candidateScore'
import type { ScanCandidate, ScanHighlightItem } from '../types'

export function useScanHighlights({ candidates }: { candidates: ScanCandidate[] }) {
  const [apiHighlights, setApiHighlights] = useState<ScanHighlightItem[]>([])
  const [highlightLoading, setHighlightLoading] = useState(true)

  useEffect(() => {
    setHighlightLoading(true)
    apiFetch('/api/ui/scan-highlights', { cacheMs: 60_000, timeoutMs: 30_000 })
      .then((res) => { if (Array.isArray(res?.data)) setApiHighlights(res.data) })
      .catch(() => { /* API 호출 실패 시 로컈 폴백 사용 */ })
      .finally(() => setHighlightLoading(false))
  }, [])

  const localHighlights = useMemo<ScanHighlightItem[]>(() => {
    return [...candidates]
      .map((c) => {
        const lead = scoreLeadAccumulationCandidate(c)
        return {
          ...c,
          leadAccumulationStage: lead.stage,
          leadAccumulationScore: lead.score,
          isAccumulationSignal: lead.stage !== 'none' && lead.score >= 55,
        }
      })
      .filter(c => ['A', 'B'].includes(String(c.entry_grade || '').toUpperCase()))
      .sort((a, b) => {
        const aAcc = a.isAccumulationSignal ? 1 : 0
        const bAcc = b.isAccumulationSignal ? 1 : 0
        if (aAcc !== bAcc) return bAcc - aAcc
        const leadA = a.leadAccumulationScore ?? 0
        const leadB = b.leadAccumulationScore ?? 0
        if (leadA !== leadB) return leadB - leadA
        const ga = gradeScore(a.entry_grade)
        const gb = gradeScore(b.entry_grade)
        if (ga !== gb) return gb - ga
        const wa = a.warn_score ?? 999
        const wb = b.warn_score ?? 999
        if (wa !== wb) return wa - wb
        return (b.entry_score ?? 0) - (a.entry_score ?? 0)
      })
      .slice(0, 5)
  }, [candidates])

  // 스캔 화면은 눌림목 원본 후보 기반 TOP 카드로 유지한다.
  const activeHighlights = localHighlights
  const highlightOverlapSet = useMemo(() => new Set(apiHighlights.map((row) => row.code)), [apiHighlights])

  return {
    apiHighlights,
    highlightLoading,
    activeHighlights,
    highlightOverlapSet,
  }
}
