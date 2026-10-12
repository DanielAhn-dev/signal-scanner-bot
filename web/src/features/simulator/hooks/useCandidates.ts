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
      console.log('[loadAlgoCandidates] 시작...')
      // scan-candidates fetch
      const ts = Date.now()
      const scanRes = await apiFetch(`/api/ui/scan-candidates?limit=80&cacheMs=0&_ts=${ts}`, { cacheMs: 0, timeoutMs: 20_000 })
      const scanList = Array.isArray(scanRes?.data) ? scanRes.data : []
      console.log('[loadAlgoCandidates] scan-candidates:', scanList.length, '개')
      if (scanList.length > 0) {
        console.log('[loadAlgoCandidates] API 원본 첫 종목:', {
          code: scanList[0].code,
          current_price: scanList[0].current_price,
          close: scanList[0].close,
          entry_grade: scanList[0].entry_grade,
        })
      }
      // scan-highlights fetch
      const hlRes = await apiFetch('/api/ui?route=scan-highlights', { cacheMs: 10000, timeoutMs: 15000 })
      const hlList = Array.isArray(hlRes?.data) ? hlRes.data : []
      console.log('[loadAlgoCandidates] scan-highlights:', hlList.length, '개')

      const finalCandidates = mergeAlgoCandidates(scanList, hlList)
      console.log('[loadAlgoCandidates] 최종 후보:', finalCandidates.length, '개')
      if (finalCandidates.length > 0) {
        console.log('[loadAlgoCandidates] 첫 후보:', finalCandidates[0].code, finalCandidates[0].name)
      }
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
