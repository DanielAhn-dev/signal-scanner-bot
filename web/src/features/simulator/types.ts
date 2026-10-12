import type { HighlightPlanItem } from './planStore'

export type RecommendSource = 'algo' | 'watchlist' | 'items'

export type CompareResult = { algo: HighlightPlanItem[]; watchlist: HighlightPlanItem[] }

export type PlanHistoryEntry = { updatedAt: string; plan: any }
