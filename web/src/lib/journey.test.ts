import { describe, expect, it } from 'vitest'
import { computeJourney } from './journey'

const none = { hasCheck: false, hasAccount: false, hasProfile: false, monthlyDeposit: 0, hasDropPlan: false }

describe('다음 할 일 길잡이', () => {
  it('처음 온 사람은 내 돈 점검부터', () => {
    const j = computeJourney(none)
    expect(j.next.key).toBe('money')
    expect(j.next.route).toBe('budget')
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

  it('길을 고르지 않았으면 실계좌가 있으면 이미 투자 중, 시드만 있으면 처음 시작, 둘 다 없으면 고르게 한다', () => {
    expect(computeJourney(none).path).toBeNull()
    expect(computeJourney({ ...none, hasAccount: true }).path).toBe('start')
    expect(computeJourney({ ...none, hasAccount: true, hasRealHoldings: true }).path).toBe('invested')
    expect(computeJourney({ ...none, hasRealHoldings: true, entryPath: 'start' }).path).toBe('start')
  })

  it('이미 투자 중인 길은 계좌 넣기 → 진단 → 내 돈 점검 → 새 돈은 지수로 순서', () => {
    const j = computeJourney({ ...none, entryPath: 'invested' })
    expect(j.steps.map((s) => s.key)).toEqual(['holdings', 'review', 'money', 'monthly', 'drop', 'checkin'])
    expect(j.next.key).toBe('holdings')
    expect(j.steps.find((s) => s.key === 'review')!.why).toMatch(/억지로 팔지 않아요/)
    expect(j.steps.find((s) => s.key === 'monthly')!.side?.route).toBe('start')
    expect(j.steps.find((s) => s.key === 'checkin')!.route).toBe('choices')
  })

  it('진단은 직접 남긴 점검 기록이 있어야, 새 돈은 실제 적립 기록이 있어야 끝난다(가상 월 적립액은 세지 않음)', () => {
    const base = { ...none, entryPath: 'invested' as const, hasRealHoldings: true }
    expect(computeJourney(base).next.key).toBe('review')
    expect(computeJourney({ ...base, hasManualCheck: true }).next.key).toBe('money')
    expect(computeJourney({ ...base, hasManualCheck: true, hasCheck: true, monthlyDeposit: 300_000 }).next.key).toBe('monthly')
    expect(computeJourney({ ...base, hasManualCheck: true, hasCheck: true, hasRealDeposit: true }).next.key).toBe('drop')
  })
})
