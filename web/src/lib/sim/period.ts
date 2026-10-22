/**
 * 시뮬레이터 기간 고르기 — 빠른 선택(최근 n년·사건 직전)을 구성들이 함께 쓸 수 있는 달 안으로 맞춘다.
 * 구성마다 이력 시작이 달라, 비교하는 구성 모두에 가격이 있는 달(교집합)만 고를 수 있다.
 */

export type PeriodPreset =
  | { key: string; label: string; kind: 'recent'; years: number }
  | { key: string; label: string; kind: 'from'; start: string; note: string }

export const PERIOD_PRESETS: PeriodPreset[] = [
  { key: 'r5', label: '최근 5년', kind: 'recent', years: 5 },
  { key: 'r10', label: '최근 10년', kind: 'recent', years: 10 },
  { key: 'r15', label: '최근 15년', kind: 'recent', years: 15 },
  { key: 'r20', label: '최근 20년', kind: 'recent', years: 20 },
  { key: 'dotcom', label: '2000 닷컴 고점', kind: 'from', start: '200003', note: '나스닥이 고점에서 약 80% 떨어지기 직전' },
  { key: 'gfc', label: '2008 위기 직전', kind: 'from', start: '200710', note: '코스피 고점 직후, 금융위기 직전' },
  { key: 'covid', label: '2020 코로나 직전', kind: 'from', start: '202001', note: '한 달 새 30% 넘게 떨어지기 직전' },
]

export function shiftYm(ym: string, months: number): string {
  const total = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4)) - 1 + months
  return `${Math.floor(total / 12)}${String((total % 12) + 1).padStart(2, '0')}`
}

/** 여러 구성이 모두 쓸 수 있는 달 — 각 구성의 공통 월을 다시 교집합 */
export function sharedMonths(lists: string[][]): string[] {
  if (!lists.length) return []
  const rest = lists.slice(1).map((l) => new Set(l))
  return lists[0].filter((m) => rest.every((s) => s.has(m)))
}

export type ResolvedPeriod = {
  start: string
  end: string
  /** 고른 시작이 쓸 수 있는 달보다 앞이라 첫 달로 당겼다 */
  clamped: boolean
}

/** 빠른 선택 → 실제 시작·끝. 쓸 수 있는 달이 2개 미만이면 null */
export function resolvePreset(preset: PeriodPreset, months: string[]): ResolvedPeriod | null {
  if (months.length < 2) return null
  const end = months[months.length - 1]
  const want = preset.kind === 'recent' ? shiftYm(end, -preset.years * 12) : preset.start
  return pickStart(want, end, months)
}

/** 직접 고른 시작·끝을 쓸 수 있는 달로 맞춘다 — 시작이 너무 이르면 첫 달, 끝이 시작 이하이면 마지막 달 */
export function resolveCustom(start: string, end: string, months: string[]): ResolvedPeriod | null {
  if (months.length < 2) return null
  const last = months[months.length - 1]
  const e = months.includes(end) && end > start ? end : last
  return pickStart(start, e, months)
}

function pickStart(want: string, end: string, months: string[]): ResolvedPeriod | null {
  const first = months[0]
  if (want < first) return end > first ? { start: first, end, clamped: true } : null
  // 쓸 수 있는 달 중 want 이상인 첫 달 (가운데 빠진 달이 있어도)
  const start = months.find((m) => m >= want) ?? first
  if (start >= end) {
    const i = months.indexOf(end)
    return i > 0 ? { start: months[i - 1], end, clamped: true } : null
  }
  return { start, end, clamped: false }
}

export function ymText(ym: string): string {
  return `${ym.slice(0, 4)}-${ym.slice(4)}`
}

/** 개월 수 → "11년 8개월" */
export function spanText(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (!y) return `${m}개월`
  return m ? `${y}년 ${m}개월` : `${y}년`
}
