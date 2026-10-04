/**
 * 계좌별 사용 시점 → 단계 전환 안내. 기본은 지수 100%이고, 사용자가 "이 계좌는 언제 쓴다"고 정한 경우에만 적용한다.
 * 전환표는 날짜만 보고 정한다(시장 예측 없음). 표와 근거는 scripts/research/validate_glide_path.py → researchFacts.ts(GLIDE_FACTS).
 * 안내만 하며 주문은 내지 않는다. 순수 함수만 둔다.
 */
import { GLIDE_FACTS } from '../data/researchFacts'
import { daysBetween } from './childGift'

export type GlideProfile = 'gentle' | 'safe'
export const GLIDE_PROFILES: ReadonlyArray<{ key: GlideProfile; label: string; note: string }> = [
  { key: 'gentle', label: '완만', note: '기간이 줄수록 천천히 내립니다. 수익은 덜 포기하고 낙폭은 줄입니다.' },
  { key: 'safe', label: '보수', note: '더 일찍·더 많이 내립니다. 사용 직전엔 주식 0%입니다.' },
]

export type AccountGoal = { id: string; label: string; targetDate: string; valueWon: number; stockPct: number; profile: GlideProfile }
export type AccountGoalState = { goals: AccountGoal[] }
export const EMPTY_GOAL_STATE: AccountGoalState = { goals: [] }
export const MAX_GOALS = 8

/** 표의 첫 구간 경계 — 이보다 멀면 첫 행 비중을 유지한다 */
export const GLIDE_START_YEARS = 10
const DAYS_PER_YEAR = 365.25

type Row = { over: number; stock: number }
const tableOf = (profile: GlideProfile): ReadonlyArray<Row> => GLIDE_FACTS.tables[profile === 'safe' ? '보수' : '완만']

/** 'YYYY-MM-DD'에서 달력 기준 n년 전 (2/29는 2/28로) */
function yearsBefore(date: string, years: number): string {
  const y = Number(date.slice(0, 4)) - years
  const md = date.slice(5)
  return `${y}-${md === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? '02-28' : md}`
}

/** 오늘이 (사용일 − over년)보다 앞이면 그 행 — 검증한 표 그대로(완만은 10년 초과 100%, 보수는 80%). 전환일 당일부터 다음 구간 */
export function glideWeight(profile: GlideProfile, today: string, targetDate: string): number {
  const table = tableOf(profile)
  for (const row of table) if (today < yearsBefore(targetDate, row.over)) return row.stock
  return table.at(-1)?.stock ?? 0
}

export type GlidePlan = {
  remainingYears: number
  /** 사용 시점이 이미 지났거나 오늘이면 true */
  due: boolean
  /** 전환 구간에 들어왔는가 (10년 이내) */
  gliding: boolean
  recommendedPct: number
  currentPct: number
  /** 양수=주식을 줄일 금액, 음수=주식을 늘릴 여지 */
  reduceWon: number
  /** 다음 전환일과 그때 비중 — 마지막 구간이면 null */
  next: { date: string; pct: number } | null
}

/** 계좌 하나의 오늘 권장 비중과 옮길 금액. capPct(감내 낙폭 상한)가 있으면 둘 중 낮은 쪽 */
export function glidePlan(goal: AccountGoal, today: string, capPct?: number): GlidePlan {
  const days = daysBetween(today, goal.targetDate)
  const remainingYears = days / DAYS_PER_YEAR
  const table = tableOf(goal.profile)
  const base = glideWeight(goal.profile, today, goal.targetDate)
  const recommendedPct = capPct === undefined ? base : Math.min(base, capPct)
  const reduceWon = Math.round(goal.valueWon * (goal.stockPct - recommendedPct) / 100)
  let next: GlidePlan['next'] = null
  if (days > 0) {
    // 지금 비중이 속한 구간의 끝(임계값)에 닿는 날이 다음 전환일
    const edge = table.find((r) => today < yearsBefore(goal.targetDate, r.over))?.over ?? 0
    if (edge > 0) {
      const nextRow = table.find((r) => r.over < edge)
      const nextBase = nextRow ? nextRow.stock : 0
      next = { date: yearsBefore(goal.targetDate, edge), pct: capPct === undefined ? nextBase : Math.min(nextBase, capPct) }
    }
  }
  return { remainingYears, due: days <= 0, gliding: remainingYears <= GLIDE_START_YEARS, recommendedPct, currentPct: goal.stockPct, reduceWon, next }
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

/** 저장값을 믿지 않고 걸러낸다 */
export function sanitizeGoalState(raw: unknown): AccountGoalState {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { goals?: unknown }).goals)) return EMPTY_GOAL_STATE
  const goals: AccountGoal[] = []
  for (const g of (raw as { goals: unknown[] }).goals.slice(0, MAX_GOALS)) {
    if (!g || typeof g !== 'object') continue
    const r = g as Record<string, unknown>
    const id = typeof r.id === 'string' && r.id ? r.id.slice(0, 24) : ''
    const value = Number(r.valueWon)
    const stock = Number(r.stockPct)
    if (!id || !isDate(r.targetDate) || !Number.isFinite(value) || value < 0 || value > 100_000_000_000 || !Number.isFinite(stock)) continue
    goals.push({
      id,
      label: (typeof r.label === 'string' ? r.label.trim().slice(0, 20) : '') || '계좌',
      targetDate: r.targetDate,
      valueWon: Math.round(value),
      stockPct: Math.min(100, Math.max(0, Math.round(stock))),
      profile: r.profile === 'safe' ? 'safe' : 'gentle',
    })
  }
  return { goals }
}
