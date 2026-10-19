import { monthlyRate, monthsBetween, planValueAt } from '../../../src/services/goalTracker'

/**
 * 목표 화면의 "지나온 길 · 지금 · 앞으로" 그래프 좌표. 가로축은 계획 시작일로부터 개월 수.
 * 앞으로 선은 서버의 예상 도달(monthsToReach)과 같은 식 — 지금 평가액에서 매달 계획 수익률 + 월 입금 —
 * 이라 "예상 도달" 칸과 그래프의 목표선 교차가 같은 달이다. 수익 0% 선은 같은 입금만 쌓은 기준선.
 */
export type GoalPathInput = {
  today: string
  settings: { startDate: string; startEquity: number; planAnnualPct: number; monthlyContribution: number }
  equity: number
  requiredSeed: number | null
  monthsToReach: number | null
  trail?: Array<{ date: string; total: number }>
}

export type Pt = { x: number; v: number }
export type GoalPath = {
  nowX: number
  endX: number
  plan: Pt[]
  actual: Pt[]
  future: Pt[]
  noReturn: Pt[]
  goal: number | null
  /** 앞으로 선이 목표에 닿는 x — 그래프 범위 밖이면 null */
  etaX: number | null
  /** 앞으로 몇 개월을 그렸는지 */
  aheadMonths: number
}

/** 앞으로 그릴 최대 기간 — 너무 먼 미래는 선이 의미 없이 길어진다 */
export const MAX_AHEAD_MONTHS = 360

export function buildGoalPath(input: GoalPathInput): GoalPath {
  const s = input.settings
  const nowX = Math.max(0, monthsBetween(s.startDate, input.today))
  const goal = input.requiredSeed != null && Number.isFinite(input.requiredSeed) && input.requiredSeed > 0 ? input.requiredSeed : null
  const reached = goal != null && input.equity >= goal
  const eta = input.monthsToReach
  const aheadMonths = reached ? 0 : eta != null && eta <= MAX_AHEAD_MONTHS ? Math.max(12, eta) : eta == null && goal == null ? 60 : MAX_AHEAD_MONTHS

  // planValueAt은 시작 평가액·수익률·입금만 쓴다 (목표 월 수익은 계획선과 무관)
  const planAt = (k: number) => planValueAt({ ...s, targetMonthlyProfit: 0 }, k)
  const plan: Pt[] = []
  for (let k = 0; k < nowX; k += 1) plan.push({ x: k, v: planAt(k) })
  plan.push({ x: nowX, v: planAt(nowX) })

  const actual: Pt[] = (input.trail ?? [])
    .map((p) => ({ x: monthsBetween(s.startDate, p.date), v: p.total }))
    .filter((p) => p.x <= nowX && Number.isFinite(p.v))
  actual.push({ x: nowX, v: input.equity })

  const m = monthlyRate(s.planAnnualPct)
  const c = Math.max(0, s.monthlyContribution)
  const future: Pt[] = [{ x: nowX, v: input.equity }]
  const noReturn: Pt[] = [{ x: nowX, v: input.equity }]
  let v = input.equity
  for (let k = 1; k <= aheadMonths; k += 1) {
    v = v * (1 + m) + c
    future.push({ x: nowX + k, v })
    noReturn.push({ x: nowX + k, v: input.equity + c * k })
  }
  const etaX = !reached && eta != null && eta <= aheadMonths ? nowX + eta : null
  return { nowX, endX: nowX + aheadMonths, plan, actual, future, noReturn, goal, etaX, aheadMonths }
}

/** 시작일 + x개월 → 그 시점의 연도 (눈금용) */
export function yearAt(startDate: string, x: number): number {
  const y = Number(startDate.slice(0, 4))
  const mo = Number(startDate.slice(5, 7)) - 1 + Math.floor(x)
  return y + Math.floor(mo / 12)
}

/** 1월이 되는 x 값들 — 라벨이 maxLabels개를 넘지 않게 n년마다 */
export function yearTicks(startDate: string, endX: number, maxLabels = 6): Array<{ x: number; year: number }> {
  const startMonth = Number(startDate.slice(5, 7)) - 1
  const first = startMonth === 0 ? 0 : 12 - startMonth
  const all: Array<{ x: number; year: number }> = []
  for (let x = first; x <= endX; x += 12) all.push({ x, year: yearAt(startDate, x) })
  const every = Math.max(1, Math.ceil(all.length / maxLabels))
  return all.filter((_, i) => i % every === 0)
}
