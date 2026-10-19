import { describe, expect, it } from 'vitest'
import { formatMonths, impliedAnnualRate, milestoneTargets, monthlyAfterYears, monthsToTarget, projectValue, yearAfterMonths } from './goalReach'

describe('목표까지의 길', () => {
  it('적립 배율 ↔ 연 수익률이 서로 맞는다', () => {
    const r = impliedAnnualRate(1.5, 180)!
    // 적립 배율은 매달 초에 사서 끝에 평가(simulateDca), projectValue는 매달 말에 넣는다 — 한 달 수익만큼 차이
    expect((projectValue({ monthly: 1, rate: r }, 180) * Math.pow(1 + r, 1 / 12)) / 180).toBeCloseTo(1.5, 4)
    expect(impliedAnnualRate(1, 120)).toBeCloseTo(0, 6)
    expect(impliedAnnualRate(0, 120)).toBeNull()
  })

  it('연 5%·매달 122만원: 15년 약 3.2억, 10억은 31년, 매년 5% 늘리면 23년, 첫 1억 6년', () => {
    const base = { monthly: 1_220_000, rate: 0.05 }
    expect(projectValue(base, 180) / 1e8).toBeCloseTo(3.2, 0)
    expect(Math.ceil(monthsToTarget(base, 1e9)! / 12)).toBe(31)
    expect(Math.ceil(monthsToTarget({ ...base, raisePct: 0.05 }, 1e9)! / 12)).toBe(23)
    expect(Math.ceil(monthsToTarget(base, 1e8)! / 12)).toBe(6)
  })

  it('서버 monthsToReach와 같은 달 (목표 트래커 예상 도달과 화면 선택지가 어긋나지 않게)', async () => {
    const { monthsToReach } = await import('../../../src/services/goalTracker')
    for (const [lump, monthly, rate, target] of [[0, 1_220_000, 0.056, 1e9], [60_000_000, 1_000_000, 0.099, 3e8], [0, 500_000, 0.04, 1e8]]) {
      expect(monthsToTarget({ monthly, rate, lump }, target)).toBe(monthsToReach({ fromEquity: lump, target, planAnnualPct: rate * 100, monthlyContribution: monthly }))
      expect(monthsToTarget({ monthly, rate, lump, raisePct: 0.05 }, target)).toBe(monthsToReach({ fromEquity: lump, target, planAnnualPct: rate * 100, monthlyContribution: monthly, raisePct: 0.05 }))
    }
  })

  it('넣는 돈이 많을수록·늘릴수록 빨리 닿고, 못 닿으면 null', () => {
    const a = monthsToTarget({ monthly: 1_000_000, rate: 0.05 }, 3e8)!
    expect(monthsToTarget({ monthly: 1_300_000, rate: 0.05 }, 3e8)!).toBeLessThan(a)
    expect(monthsToTarget({ monthly: 1_000_000, rate: 0.05, raisePct: 0.03 }, 3e8)!).toBeLessThan(a)
    expect(monthsToTarget({ monthly: 1, rate: 0 }, 1e9, 120)).toBeNull()
    expect(monthsToTarget({ monthly: 1, rate: 0.05, lump: 2e9 }, 1e9)).toBe(0)
  })

  it('도우미', () => {
    expect(monthlyAfterYears(1_220_000, 0.05, 1)).toBeCloseTo(1_281_000)
    expect(milestoneTargets(1e9)).toEqual([1e8, 3e8, 5e8, 1e9])
    expect(milestoneTargets(2e8)).toEqual([1e8, 2e8])
    expect(formatMonths(76)).toBe('6년 4개월')
    expect(formatMonths(8)).toBe('8개월')
    expect(yearAfterMonths('2026-10-19', 3)).toBe(2027)
    expect(yearAfterMonths('2026-10-19', 2)).toBe(2026)
  })
})
