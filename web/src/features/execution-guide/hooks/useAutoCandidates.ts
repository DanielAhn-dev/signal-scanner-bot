import { useMemo, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { getCandidateScoreByVersion, rankHighlightCandidate, rankScanCandidate } from '../lib/candidateRank'
import { autoSourceLabelByMode } from '../lib/codes'
import { pickDiversifiedCandidates } from '../lib/diversify'
import type { AutoCandidate, CandidateMode, ScoreVersion } from '../types'

/** 자동 후보 찾기: 스캔·집행우선 데이터를 모드별로 점수화해 섹터별로 골고루 고른다 */
export function useAutoCandidates(input: {
  codeList: string[]
  setCodesText: React.Dispatch<React.SetStateAction<string>>
  setSourceLabel: React.Dispatch<React.SetStateAction<string>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const { codeList, setCodesText, setSourceLabel, setError } = input
  const [autoCandidates, setAutoCandidates] = useState<AutoCandidate[]>([])
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoError, setAutoError] = useState<string | null>(null)
  const [candidateMode, setCandidateMode] = useState<CandidateMode>('balanced')
  const [scoreVersion, setScoreVersion] = useState<ScoreVersion>('v2')
  const [showAutoFinder, setShowAutoFinder] = useState(false)

  const visibleAutoCandidates = useMemo(
    () => [...autoCandidates].sort((a, b) => getCandidateScoreByVersion(b, scoreVersion) - getCandidateScoreByVersion(a, scoreVersion)),
    [autoCandidates, scoreVersion],
  )

  const fetchAutoCandidates = async (): Promise<AutoCandidate[]> => {
    const [highlightsRes, scanRes] = await Promise.all([
      apiFetch('/api/ui/scan-highlights', { cacheMs: 30_000, timeoutMs: 30_000 }).catch(() => null),
      apiFetch('/api/ui/scan-candidates?limit=120&cacheMs=0', { cacheMs: 0, timeoutMs: 30_000 }).catch(() => null),
    ])

    const highlightItems = Array.isArray(highlightsRes?.data) ? highlightsRes.data : []
    const scanItems = Array.isArray(scanRes?.data) ? scanRes.data : []
    const ranked = [
      ...highlightItems.map((row: any) => rankHighlightCandidate(row, candidateMode)),
      ...scanItems.map((row: any) => rankScanCandidate(row, candidateMode)),
    ].filter((item) => item.code)

    if (ranked.length === 0) return []

    const merged = new Map<string, AutoCandidate>()
    for (const row of ranked) {
      const prev = merged.get(row.code)
      if (!prev || row.score > prev.score) {
        merged.set(row.code, row)
      }
    }

    const sorted = [...merged.values()].sort((a, b) => b.score - a.score)
    return pickDiversifiedCandidates(sorted, 16, 2)
  }

  const loadAutoCandidates = async () => {
    setAutoLoading(true)
    setAutoError(null)
    try {
      const diversified = await fetchAutoCandidates()

      if (diversified.length === 0) {
        setAutoCandidates([])
        setAutoError('자동 후보를 찾지 못했습니다. 스캔 데이터 동기화 후 다시 시도해 주세요.')
        return
      }

      setAutoCandidates(diversified)
      const autoLabel = autoSourceLabelByMode(candidateMode)
      setSourceLabel(autoLabel)
      if (codeList.length === 0 && diversified.length > 0) {
        const sortedForView = [...diversified].sort((a, b) => getCandidateScoreByVersion(b, scoreVersion) - getCandidateScoreByVersion(a, scoreVersion))
        setCodesText(sortedForView.slice(0, 6).map((row) => row.code).join(', '))
      }
    } catch (e: any) {
      setAutoError(e?.message || String(e))
      setAutoCandidates([])
    } finally {
      setAutoLoading(false)
    }
  }

  const useAutoCandidatesAsCodes = () => {
    if (autoCandidates.length === 0) {
      setError('먼저 자동 후보 찾기를 실행해 주세요.')
      return
    }
    const next = visibleAutoCandidates.slice(0, 8).map((row) => row.code).join(', ')
    setCodesText(next)
    setSourceLabel(autoSourceLabelByMode(candidateMode))
    setError(null)
  }

  return {
    autoCandidates, setAutoCandidates, autoLoading, autoError, candidateMode, setCandidateMode,
    scoreVersion, setScoreVersion, showAutoFinder, setShowAutoFinder, visibleAutoCandidates,
    fetchAutoCandidates, loadAutoCandidates, useAutoCandidatesAsCodes,
  }
}
