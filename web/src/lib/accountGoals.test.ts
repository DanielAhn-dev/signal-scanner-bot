import { describe, expect, it } from 'vitest'
import { capFromTolerance, glidePlan, glideWeight, sanitizeGoalState, type AccountGoal } from './accountGoals'

const goal = (over: Partial<AccountGoal> = {}): AccountGoal => ({ id: 'a', label: '전세', targetDate: '2031-10-04', valueWon: 100_000_000, stockPct: 100, profile: 'gentle', ...over })

describe('단계 전환 비중', () => {
  const at = (profile: 'gentle' | 'safe', yearsLeft: number, extraDays = 0) => {
    const target = '2040-06-15'
    const d = new Date(Date.parse(`${target}T00:00:00Z`)); d.setUTCFullYear(d.getUTCFullYear() - yearsLeft); d.setUTCDate(d.getUTCDate() + extraDays)
    return glideWeight(profile, d.toISOString().slice(0, 10), target)
  }
  it('완만: 10년 초과 100, 5~10년 80, 3~5년 60, 1~3년 40, 1년 이내 20 (전환일 당일부터 다음 구간)', () => {
    expect(at('gentle', 12)).toBe(100)
    expect(at('gentle', 10, -1)).toBe(100)
    expect(at('gentle', 10)).toBe(80)
    expect(at('gentle', 5, -1)).toBe(80)
    expect(at('gentle', 5)).toBe(60)
    expect(at('gentle', 3)).toBe(40)
    expect(at('gentle', 1)).toBe(20)
    expect(at('gentle', 0, -30)).toBe(20)
  })
  it('보수: 10년 초과 80에서 시작해 마지막엔 0', () => {
    expect(at('safe', 12)).toBe(80)
    expect(at('safe', 4)).toBe(40)
    expect(at('safe', 0, -30)).toBe(0)
  })
})

describe('계좌 계획', () => {
  it('5년 남은 완만 계좌가 주식 100%면 60%로 줄이도록 4천만원 안내, 다음 전환은 3년 전', () => {
    const p = glidePlan(goal(), '2026-10-04')
    expect(p.recommendedPct).toBe(60)
    expect(p.reduceWon).toBe(40_000_000)
    expect(p.next?.pct).toBe(40)
    expect(p.next?.date).toBe('2028-10-04')
    expect(p.due).toBe(false)
  })
  it('감내 낙폭 상한이 더 낮으면 그 값을 쓴다', () => {
    expect(glidePlan(goal(), '2026-10-04', 20).recommendedPct).toBe(20)
  })
  it('이미 낮게 들고 있으면 줄일 금액이 음수(늘릴 여지)', () => {
    expect(glidePlan(goal({ stockPct: 40 }), '2026-10-04').reduceWon).toBe(-20_000_000)
  })
  it('마지막 구간은 다음 전환이 없고, 지난 날짜는 due', () => {
    expect(glidePlan(goal({ targetDate: '2027-03-01' }), '2026-10-04').next).toBeNull()
    expect(glidePlan(goal({ targetDate: '2026-01-01' }), '2026-10-04').due).toBe(true)
  })
  it('먼 미래는 기본 지수 100% 유지, 다음 전환은 10년 전', () => {
    const p = glidePlan(goal({ targetDate: '2046-10-04' }), '2026-10-04')
    expect(p.recommendedPct).toBe(100)
    expect(p.gliding).toBe(false)
    expect(p.next?.pct).toBe(80)
  })
})

describe('버틸 하락폭 상한', () => {
  it('−20%를 버티면 상한 20%(표의 한 칸 낮은 제안)가 5년 남은 완만 60%보다 낮아 적용된다', () => {
    const p = glidePlan(goal(), '2026-10-04', capFromTolerance(20))
    expect(p.recommendedPct).toBe(20)
    expect(p.capped).toBe(true)
    expect(p.reduceWon).toBe(80_000_000)
  })
  it('상한이 전환표보다 높으면 전환표가 이긴다, 입력이 없으면 상한 없음', () => {
    expect(glidePlan(goal(), '2026-10-04', capFromTolerance(40)).capped).toBe(false)
    expect(capFromTolerance(undefined)).toBeUndefined()
  })
  it('저장값의 버틸 하락폭은 10~50만 받는다', () => {
    const base = { id: 'x', targetDate: '2030-01-01', valueWon: 1, stockPct: 1 }
    expect(sanitizeGoalState({ goals: [{ ...base, tolerancePct: 30 }] }).goals[0].tolerancePct).toBe(30)
    expect(sanitizeGoalState({ goals: [{ ...base, tolerancePct: 90 }] }).goals[0].tolerancePct).toBeUndefined()
    expect(sanitizeGoalState({ goals: [{ ...base }] }).goals[0].tolerancePct).toBeUndefined()
  })
})

describe('저장값 정리', () => {
  it('잘못된 항목을 버리고 비중을 0~100으로 맞춘다', () => {
    const s = sanitizeGoalState({ goals: [{ id: 'x', label: '  ', targetDate: '2030-01-01', valueWon: 5, stockPct: 150, profile: 'zzz' }, { id: '', targetDate: '2030-01-01', valueWon: 1, stockPct: 1 }, { id: 'y', targetDate: 'bad', valueWon: 1, stockPct: 1 }] })
    expect(s.goals).toHaveLength(1)
    expect(s.goals[0]).toMatchObject({ label: '계좌', stockPct: 100, profile: 'gentle' })
    expect(sanitizeGoalState(null).goals).toEqual([])
  })
})
