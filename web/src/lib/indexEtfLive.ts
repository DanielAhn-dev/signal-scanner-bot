import { useEffect, useState } from 'react'
import { apiFetch } from './api'
import { INDEX_ETF_CANDIDATES } from '../data/accumulateData'
import { STATIC_INDEX_ETF_VIEW, mergeLiveCandidates, type IndexEtfCandidatesView } from './indexEtfCandidates'

// 모아가기 추천과 만기 '갈 곳'이 같은 값을 보도록 한 번 받은 결과를 모듈에 둔다
let shared: Promise<IndexEtfCandidatesView> | null = null

function loadOnce(): Promise<IndexEtfCandidatesView> {
  if (!shared) {
    const codes = INDEX_ETF_CANDIDATES.map((c) => c.code).join(',')
    shared = apiFetch(`/api/ui/index-etf-metrics?codes=${codes}`, { timeoutMs: 15_000, retries: 0 })
      .then((res) => mergeLiveCandidates(INDEX_ETF_CANDIDATES, res?.data))
      .catch(() => {
        shared = null // 다음 화면 진입 때 다시 시도
        return STATIC_INDEX_ETF_VIEW
      })
  }
  return shared
}

/** 처음엔 고정 스냅샷, 서버 값이 오면 바꾼다 */
export function useIndexEtfCandidates(): IndexEtfCandidatesView {
  const [view, setView] = useState<IndexEtfCandidatesView>(STATIC_INDEX_ETF_VIEW)
  useEffect(() => {
    let cancelled = false
    loadOnce().then((v) => { if (!cancelled) setView(v) })
    return () => { cancelled = true }
  }, [])
  return view
}
