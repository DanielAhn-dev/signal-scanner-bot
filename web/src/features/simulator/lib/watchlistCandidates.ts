import { defaultPlanItem, type HighlightPlanItem } from '../planStore'

/** 관심종목 positions 응답 → 추천 후보. 가격이 없으면 50,000원을 가정한다. */
export function buildWatchlistCandidates(positions: any[]): HighlightPlanItem[] {
  return positions
    .map((pos: any) => {
      const code = String(pos.code || pos.symbol || pos.ticker || '').trim()
      const name = String(pos.stock_name || pos.name || code || '').trim()
      if (!code || !name) return null
      const currentPrice = Number(pos.current_price ?? pos.close ?? pos.stock?.close ?? 0) || 50000
      const closePrice = Number(pos.close ?? pos.stock?.close ?? 0) || currentPrice
      // 기본값으로 초기화 (나중에 사용자가 조정 가능)
      return {
        ...defaultPlanItem({ code, name, sector_id: pos.sector_id }),
        source: 'watchlist',
        signal_score: Number(pos.priority ?? 0) || 0,
        signal_rank: Number(pos.rank ?? 9999) || 9999,
        market: String(pos.market || pos.market_type || pos.exchange || pos.stock?.market || ''),
        current_price: currentPrice,
        close: closePrice,
      }
    })
    .filter((item: any) => item != null) as HighlightPlanItem[]
}
