import { empiricalWinProb } from '../../lib/tpSlBaseRates'
export const HIGHLIGHT_SIM_PLAN_KEY = 'highlight_simulation_plan_v1'

export type HighlightPlanItem = {
  id: string
  code: string
  name: string
  market?: string
  source?: 'scan-candidates' | 'scan-highlights' | 'watchlist' | 'manual'
  signal_score?: number
  signal_rank?: number
  sector_id?: string | null
  amount: number
  targetPct: number
  stopPct: number
  winProb: number
  split1: number
  split2: number
  split3: number
  current_price?: number
  close?: number
  shares?: number
  buyPrice?: number
}

export type HighlightSimulationPlan = {
  createdAt: number
  totalCapital: number
  notes?: string
  items: HighlightPlanItem[]
}

export function defaultPlanItem(input: {
  code: string
  name: string
  sector_id?: string | null
  amount?: number
  id?: string
}): HighlightPlanItem {
  const code = String(input.code || '')
  return {
    id: input.id || `rs_${code}`,
    code,
    name: String(input.name || code || ''),
    sector_id: input.sector_id ?? null,
    amount: Number(input.amount ?? 1_000_000),
    targetPct: 5,
    stopPct: 3,
    // 예전 기본값 58%는 근거 없는 가정이었다. 목표 +5%/손절 -3%의 5거래일 실측 환산 승률.
    winProb: empiricalWinProb(5, 3),
    split1: 40,
    split2: 35,
    split3: 25,
  }
}

export function readSimulationPlan(): HighlightSimulationPlan | null {
  try {
    const raw = localStorage.getItem(HIGHLIGHT_SIM_PLAN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.items)) return null
    return {
      createdAt: Number(parsed.createdAt || Date.now()),
      totalCapital: Number(parsed.totalCapital || 0),
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      items: parsed.items,
    }
  } catch {
    return null
  }
}

export function saveSimulationPlan(plan: HighlightSimulationPlan) {
  try {
    localStorage.setItem(HIGHLIGHT_SIM_PLAN_KEY, JSON.stringify(plan))
  } catch {
    // ignore storage errors
  }
}
