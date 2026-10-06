import { describe, expect, it } from 'vitest'
import { computeJourney } from './journey'

const none = { hasCheck: false, hasAccount: false, hasProfile: false, monthlyDeposit: 0, hasDropPlan: false }

describe('다음 할 일 길잡이', () => {
  it('처음 온 사람은 내 돈 점검부터', () => {
    const j = computeJourney(none)
    expect(j.next.key).toBe('money')
    expect(j.next.route).toBe('money-flow?tab=check')
    expect(j.steps.map((s) => s.key)).toEqual(['money', 'start', 'monthly', 'drop', 'checkin'])
  })

  it('점검을 건너뛰고 시작한 사람도 점검이 끝나지 않은 단계로 남는다', () => {
    const j = computeJourney({ ...none, hasAccount: true, hasProfile: true, monthlyDeposit: 300_000 })
    expect(j.next.key).toBe('money')
    expect(j.doneCount).toBe(2)
  })

  it('시작은 시드와 성향 답이 둘 다 있어야 끝난 것, 월 적립은 1만원 이상', () => {
    expect(computeJourney({ ...none, hasCheck: true, hasAccount: true }).next.key).toBe('start')
    expect(computeJourney({ ...none, hasCheck: true, hasAccount: true, hasProfile: true, monthlyDeposit: 5_000 }).next.key).toBe('monthly')
  })

  it('떨어질 때 할 일까지 정하면 그다음은 한 달에 한 번 확인만 남는다', () => {
    const j = computeJourney({ hasCheck: true, hasAccount: true, hasProfile: true, monthlyDeposit: 300_000, hasDropPlan: false })
    expect(j.next.key).toBe('drop')
    expect(j.next.why).toMatch(/겁나서 파는/)
    const all = computeJourney({ hasCheck: true, hasAccount: true, hasProfile: true, monthlyDeposit: 300_000, hasDropPlan: true })
    expect(all.next.key).toBe('checkin')
    expect(all.doneCount).toBe(4)
  })
})
