import { describe, expect, it } from 'vitest'
import { addMonthsClamped, splitSchedule } from './splitPlan'
import { SPLIT_PLAN_STATS } from '../data/splitPlans'

describe('splitSchedule', () => {
  it('절반 먼저: 500 → 250 → 250만원, 매월 같은 날', () => {
    const rows = splitSchedule({ total: 10_000_000, weights: [0.5, 0.25, 0.25], startDate: '2026-10-13' })
    expect(rows.map((r) => r.amount)).toEqual([5_000_000, 2_500_000, 2_500_000])
    expect(rows.map((r) => r.date)).toEqual(['2026-10-13', '2026-11-13', '2026-12-13'])
  })

  it('나누어떨어지지 않으면 마지막 회차가 나머지를 받아 합계가 총액과 같다', () => {
    const rows = splitSchedule({ total: 10_000_000, weights: [1 / 3, 1 / 3, 1 / 3], startDate: '2026-10-13' })
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(10_000_000)
    expect(rows.map((r) => r.amount)).toEqual([3_333_333, 3_333_333, 3_333_334])
  })

  it('반올림된 비중(0.3333)이어도 합계가 총액과 같다', () => {
    const rows = splitSchedule({ total: 9_999_999, weights: [0.3333, 0.3333, 0.3333], startDate: '2026-10-13' })
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(9_999_999)
  })

  it('금액이 0 이하이거나 비중이 없으면 빈 표', () => {
    expect(splitSchedule({ total: 0, weights: [1], startDate: '2026-10-13' })).toEqual([])
    expect(splitSchedule({ total: 1_000, weights: [], startDate: '2026-10-13' })).toEqual([])
  })
})

describe('addMonthsClamped', () => {
  it('말일이 없는 달은 그 달 말일로 맞추고 해를 넘긴다', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28')
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15')
  })
})

describe('SPLIT_PLAN_STATS (생성 데이터 무결성)', () => {
  it('모든 방식의 비중 합이 1이고, 분할일수록 도중 최저 평가(하위10%)가 일시금 이상이다', () => {
    for (const p of SPLIT_PLAN_STATS) expect(p.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2)
    const lump = SPLIT_PLAN_STATS.find((p) => p.id === 'lump')!
    for (const p of SPLIT_PLAN_STATS.filter((s) => s.id !== 'lump')) expect(p.minP10).toBeGreaterThanOrEqual(lump.minP10)
  })
})
