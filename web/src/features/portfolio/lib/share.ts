import type { PortfolioShareHistoryItem } from '../types'

export function pickLatestActiveShare(items: PortfolioShareHistoryItem[]): PortfolioShareHistoryItem | null {
  const now = Date.now()
  for (const item of items) {
    const expired = new Date(item.expiresAt).getTime() <= now
    if (!item.revokedAt && !expired) return item
  }
  return null
}
