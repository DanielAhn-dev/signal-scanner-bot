import { useEffect, useState } from 'react'
import type { HighlightPlanItem } from '../planStore'
import type { RecommendationStyle } from '../telegramFormat'
import {
  countTradeable,
  getCandidatesBySource as getCandidatesBySourceFor,
  recommendWithStyleFallback as recommendWithStyleFallbackFor,
} from '../lib/recommend'
import type { CompareResult, RecommendSource } from '../types'

/** 추천·비교 패널 상태. 패널이 열려 있는 동안 입력이 바뀌면 즉시 다시 계산한다. */
export function useRecommendation(input: {
  chatId: string
  items: HighlightPlanItem[]
  setItems: React.Dispatch<React.SetStateAction<HighlightPlanItem[]>>
  totalCapital: number
  monthlyProfitTarget: number
  algoCandidates: HighlightPlanItem[]
  watchlistCandidates: HighlightPlanItem[]
  toast: { show: (message: string) => void }
}) {
  const { chatId, items, setItems, totalCapital, monthlyProfitTarget, algoCandidates, watchlistCandidates, toast } = input
  const [recommendedPortfolio, setRecommendedPortfolio] = useState<HighlightPlanItem[]>([])
  const [showRecommendation, setShowRecommendation] = useState(false)
  // 'algo' = 알고리즘 추천 | 'watchlist' = 관심종목 | 'items' = 현재 종목
  const [recommendSource, setRecommendSource] = useState<RecommendSource>('algo')
  const [recommendStyle, setRecommendStyle] = useState<RecommendationStyle>('stable')
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null)
  const [showCompare, setShowCompare] = useState(false)

  const getCandidatesBySource = (source: RecommendSource): HighlightPlanItem[] =>
    getCandidatesBySourceFor(source, { algo: algoCandidates, watchlist: watchlistCandidates, items })

  const recommendWithStyleFallback = (
    baseCandidates: HighlightPlanItem[],
    preferredStyle: RecommendationStyle,
    allowFallback: boolean,
  ) => recommendWithStyleFallbackFor(baseCandidates, preferredStyle, allowFallback, totalCapital, monthlyProfitTarget)

  const generateRecommendation = () => {
    if (monthlyProfitTarget <= 0) {
      toast.show('월 목표 수익을 입력하세요.')
      return
    }

    const candidates = getCandidatesBySource(recommendSource)
    if (candidates.length === 0) {
      const srcLabel = recommendSource === 'algo' ? '알고리즘 후보' : recommendSource === 'watchlist' ? '관심종목' : '현재 종목'
      toast.show(`${srcLabel}이 없습니다. 다른 소스를 선택하거나 종목을 추가하세요.`)
      return
    }
    const allowFallback = recommendSource === 'watchlist'
    const { rows: recommended, styleUsed } = recommendWithStyleFallback(candidates, recommendStyle, allowFallback)

    if (countTradeable(recommended) === 0) {
      toast.show('추천 가능한 종목이 없습니다. (품질 기준 미충족)')
      return
    }

    if (allowFallback && styleUsed !== recommendStyle) {
      const label = styleUsed === 'balanced' ? '균형' : '공격'
      toast.show(`관심종목은 ${recommendStyle === 'stable' ? '안정' : '선택'} 기준 미충족으로 ${label} 기준을 적용했습니다.`)
    }

    setRecommendedPortfolio(recommended)
    setShowRecommendation(true)
  }

  const applyRecommendation = () => {
    if (recommendedPortfolio.length === 0) return
    setItems(recommendedPortfolio)
    setShowRecommendation(false)
    setRecommendedPortfolio([])
    toast.show('추천 포트폴리오를 적용했습니다.')
  }

  const generateCompare = () => {
    if (monthlyProfitTarget <= 0) {
      toast.show('월 목표 수익을 입력하세요.')
      return
    }
    const algoRec = algoCandidates.length > 0
      ? recommendWithStyleFallback(algoCandidates, recommendStyle, false).rows
      : []
    const watchlistRec = chatId && watchlistCandidates.length > 0
      ? recommendWithStyleFallback(watchlistCandidates, recommendStyle, true).rows
      : []
    if (countTradeable(algoRec) === 0 && countTradeable(watchlistRec) === 0) {
      toast.show('두 소스 모두 추천 가능한 종목이 없습니다.')
      return
    }
    setCompareResult({ algo: algoRec, watchlist: watchlistRec })
    setShowCompare(true)
  }

  // 추천 패널이 열려있는 상태에서 월 목표/성향/소스가 바뀌면 즉시 재계산
  useEffect(() => {
    if (!showRecommendation) return
    if (monthlyProfitTarget <= 0) return

    const candidates = getCandidatesBySource(recommendSource)
    if (candidates.length === 0) {
      setRecommendedPortfolio([])
      return
    }
    const allowFallback = recommendSource === 'watchlist'
    const { rows } = recommendWithStyleFallback(candidates, recommendStyle, allowFallback)
    setRecommendedPortfolio(rows)
  }, [
    showRecommendation,
    monthlyProfitTarget,
    recommendSource,
    recommendStyle,
    totalCapital,
    algoCandidates,
    watchlistCandidates,
    items,
  ])

  // 비교 패널이 열려있는 상태에서도 입력 변경 시 즉시 재계산
  useEffect(() => {
    if (!showCompare || monthlyProfitTarget <= 0) return

    const algoRec = algoCandidates.length > 0
      ? recommendWithStyleFallback(algoCandidates, recommendStyle, false).rows
      : []
    const watchlistRec = chatId && watchlistCandidates.length > 0
      ? recommendWithStyleFallback(watchlistCandidates, recommendStyle, true).rows
      : []

    setCompareResult({ algo: algoRec, watchlist: watchlistRec })
  }, [
    showCompare,
    monthlyProfitTarget,
    recommendStyle,
    totalCapital,
    algoCandidates,
    watchlistCandidates,
    chatId,
  ])


  return {
    recommendedPortfolio, showRecommendation, setShowRecommendation, recommendSource, setRecommendSource,
    recommendStyle, setRecommendStyle, compareResult, showCompare, setShowCompare,
    generateRecommendation, applyRecommendation, generateCompare,
  }
}
