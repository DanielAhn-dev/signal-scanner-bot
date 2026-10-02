import { empiricalWinProb } from '../../lib/tpSlBaseRates'
import { userScopedKey } from '../../lib/userState'

// 화면 간 전달용 작업본 — 사용자별 키라 계정을 바꿔도 섞이지 않고, 서버 저장본은 simulation-plan API가 따로 가진다
const planKey = () => userScopedKey('highlight_simulation_plan')

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
    const key = planKey()
    const raw = key ? localStorage.getItem(key) : null
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
    const key = planKey()
    if (key) localStorage.setItem(key, JSON.stringify(plan))
  } catch {
    // ignore storage errors
  }
}
