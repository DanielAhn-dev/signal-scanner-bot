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

const PLACEHOLDER_CODE = '000000'

export function readSimulationPlan(): HighlightSimulationPlan | null {
  try {
    const key = planKey()
    const raw = key ? localStorage.getItem(key) : null
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.items)) return null
    // 예전 시뮬레이터가 빈 계획에 넣어 자동 저장하던 자리표시 종목(000000 '예시 종목')은 뺀다.
    // 종목이 비어도 투자금은 실행 가이드가 쓰므로 계획 자체는 남긴다(리포트는 종목이 없으면 줄을 숨긴다)
    const items = parsed.items.filter((it: any) => it && String(it.code ?? '') !== PLACEHOLDER_CODE)
    return {
      createdAt: Number(parsed.createdAt || Date.now()),
      totalCapital: Number(parsed.totalCapital || 0),
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      items,
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
