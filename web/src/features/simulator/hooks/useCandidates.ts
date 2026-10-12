import { useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import type { HighlightPlanItem } from '../planStore'
import { mergeAlgoCandidates } from '../lib/algoCandidates'
import { buildWatchlistCandidates } from '../lib/watchlistCandidates'

/** 추천 후보 풀: 알고리즘 후보(항상)와 관심종목(연동된 계정만) */
export function useCandidates(chatId: string) {
  const [watchlistCandidates, setWatchlistCandidates] = useState<HighlightPlanItem[]>([])
  const [algoCandidates, setAlgoCandidates] = useState<HighlightPlanItem[]>([])
  const [loadingAlgo, setLoadingAlgo] = useState(false)
  const [loadingWatchlist, setLoadingWatchlist] = useState(false)
  const loadingCandidates = loadingAlgo || loadingWatchlist

  const loadWatchlistCandidates = async () => {
    if (!chatId) {
      setWatchlistCandidates([])
      return
    }
    setLoadingWatchlist(true)
    try {
      const res = await apiFetch(`/api/ui/positions?positionType=interest&pageSize=50&cacheMs=30000&chat_id=${encodeURIComponent(chatId)}`, { 
        cacheMs: 30000, 
        timeoutMs: 10_000 
      })
      const positions = res?.data ?? []
      setWatchlistCandidates(buildWatchlistCandidates(positions))
    } catch (e: any) {
      console.warn('관심종목 로드 실패:', e?.message)
      setWatchlistCandidates([])
    } finally {
      setLoadingWatchlist(false)
    }
  }

  // 알고리즘 후보군 fetch (chatId 여부와 무관하게 항상 로드)
  const loadAlgoCandidates = async () => {
    setLoadingAlgo(true)
    try {
      // scan-candidates + scan-highlights를 합친다
      const ts = Date.now()
      const scanRes = await apiFetch(`/api/ui/scan-candidates?limit=80&cacheMs=0&_ts=${ts}`, { cacheMs: 0, timeoutMs: 20_000 })
      const scanList = Array.isArray(scanRes?.data) ? scanRes.data : []
      const hlRes = await apiFetch('/api/ui?route=scan-highlights', { cacheMs: 10000, timeoutMs: 15000 })
      const hlList = Array.isArray(hlRes?.data) ? hlRes.data : []

      const finalCandidates = mergeAlgoCandidates(scanList, hlList)
      setAlgoCandidates(finalCandidates)
    } catch (e: any) {
      console.warn('내부 추천 후보 로드 실패:', e?.message)
      setAlgoCandidates([])
    } finally {
      setLoadingAlgo(false)
    }
  }

  // 초기화 시 항상 알고리즘 후보 로드, chatId 있으면 관심종목도 함께 로드
  useEffect(() => {
    void loadAlgoCandidates()
    if (chatId) void loadWatchlistCandidates()
  }, [chatId])

  return {
    watchlistCandidates, algoCandidates, loadingAlgo, loadingWatchlist, loadingCandidates,
    loadWatchlistCandidates, loadAlgoCandidates,
  }
}
