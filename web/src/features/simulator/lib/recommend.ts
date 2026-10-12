import type { HighlightPlanItem } from '../planStore'
import { recommendPortfolio, type RecommendationStyle } from '../telegramFormat'
import type { RecommendSource } from '../types'

export const countTradeable = (rows: HighlightPlanItem[]) => rows.filter((r) => r.code !== 'CASH').length

export function getCandidatesBySource(
  source: RecommendSource,
  pools: { algo: HighlightPlanItem[]; watchlist: HighlightPlanItem[]; items: HighlightPlanItem[] },
): HighlightPlanItem[] {
  if (source === 'algo') return pools.algo
  if (source === 'watchlist') return pools.watchlist
  return pools.items.filter((i) => i.code !== 'CASH')
}

/** 선호 성향으로 추천이 비면(관심종목만) 더 공격적인 성향으로 내려가며 재시도한다 */
export function recommendWithStyleFallback(
  baseCandidates: HighlightPlanItem[],
  preferredStyle: RecommendationStyle,
  allowFallback: boolean,
  totalCapital: number,
  monthlyProfitTarget: number,
): { rows: HighlightPlanItem[]; styleUsed: RecommendationStyle } {
  const styleOrder: RecommendationStyle[] = !allowFallback
    ? [preferredStyle]
    : preferredStyle === 'stable'
      ? ['stable', 'balanced', 'aggressive']
      : preferredStyle === 'balanced'
        ? ['balanced', 'aggressive']
        : ['aggressive']

  for (const style of styleOrder) {
    const rows = recommendPortfolio(baseCandidates, totalCapital, monthlyProfitTarget, {
      style,
    })
    if (countTradeable(rows) > 0) {
      return { rows, styleUsed: style }
    }
  }

  const fallbackStyle = styleOrder[styleOrder.length - 1]
  return {
    rows: recommendPortfolio(baseCandidates, totalCapital, monthlyProfitTarget, {
      style: fallbackStyle,
    }),
    styleUsed: fallbackStyle,
  }
}
