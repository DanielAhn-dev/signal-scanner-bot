import { describe, expect, it } from 'vitest'
import { monthsToReach, requiredSeed } from '../../../src/services/goalTracker'
import { MAX_AHEAD_MONTHS, buildGoalPath, yearTicks } from './goalPath'

const settings = { startDate: '2026-01-01', startEquity: 20_000_000, planAnnualPct: 8, monthlyContribution: 1_000_000 }
const base = { today: '2026-10-01', settings, equity: 30_000_000 }

describe('buildGoalPath', () => {
  it('앞으로 선이 목표에 닿는 달 = 서버 예상 도달(monthsToReach)', () => {
    const goal = requiredSeed(500_000, 4)
    const eta = monthsToReach({ fromEquity: 30_000_000, target: goal, planAnnualPct: 8, monthlyContribution: 1_000_000 })!
    const p = buildGoalPath({ ...base, requiredSeed: goal, monthsToReach: eta })
    expect(p.nowX).toBe(9)
    expect(p.etaX).toBe(9 + eta)
    const at = p.future.find((q) => q.x === p.etaX)!
    const before = p.future.find((q) => q.x === p.etaX! - 1)!
    expect(at.v).toBeGreaterThanOrEqual(goal)
    expect(before.v).toBeLessThan(goal)
  })

  it('수익 0% 선은 입금만 쌓이고 앞으로 선보다 위에 있지 않다', () => {
    const p = buildGoalPath({ ...base, requiredSeed: 150_000_000, monthsToReach: 80 })
    expect(p.noReturn[12].v).toBe(30_000_000 + 12_000_000)
    for (let i = 0; i < p.future.length; i += 1) expect(p.noReturn[i].v).toBeLessThanOrEqual(p.future[i].v)
  })

  it('지금 점은 실제 선의 끝이자 앞으로 선의 시작, 오늘 이후 기록은 버린다', () => {
    const p = buildGoalPath({ ...base, requiredSeed: 150_000_000, monthsToReach: 80, trail: [{ date: '2026-03-31', total: 22_000_000 }, { date: '2027-01-31', total: 1 }] })
    expect(p.actual.map((q) => q.v)).toEqual([22_000_000, 30_000_000])
    expect(p.future[0]).toEqual({ x: 9, v: 30_000_000 })
  })

  it('50년 안에 못 닿으면 최대 기간까지만 그리고 도달 표시는 없다', () => {
    const p = buildGoalPath({ ...base, requiredSeed: 1e12, monthsToReach: null })
    expect(p.aheadMonths).toBe(MAX_AHEAD_MONTHS)
    expect(p.etaX).toBeNull()
  })

  it('이미 도달했으면 앞으로 선 없이 지금까지만', () => {
    const p = buildGoalPath({ ...base, requiredSeed: 10_000_000, monthsToReach: 0 })
    expect(p.aheadMonths).toBe(0)
    expect(p.future).toHaveLength(1)
    expect(p.etaX).toBeNull()
  })

  it('필요 시드가 무한(인출률 0)이면 목표선 없이 5년만', () => {
    const p = buildGoalPath({ ...base, requiredSeed: null, monthsToReach: null })
    expect(p.goal).toBeNull()
    expect(p.aheadMonths).toBe(60)
  })
})

describe('yearTicks', () => {
  it('1월 위치에 연도, 라벨 개수 제한', () => {
    expect(yearTicks('2026-10-15', 30)).toEqual([{ x: 3, year: 2027 }, { x: 15, year: 2028 }, { x: 27, year: 2029 }])
    expect(yearTicks('2026-01-01', 360).length).toBeLessThanOrEqual(6)
  })
})
