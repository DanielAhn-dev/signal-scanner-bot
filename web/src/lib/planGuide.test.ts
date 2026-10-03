import { describe, expect, it } from 'vitest'
import { planWithdrawal, requiredMonthly, sleeveCost, stockCapFor, withdrawalFailure } from './planGuide'

describe('감내 낙폭 → 주식 비중 상한', () => {
  it('연구 표의 구간과 같다 (−15→20, −20→40, −30→60, −40→80)', () => {
    expect(stockCapFor(15).cap).toBe(20)
    expect(stockCapFor(20).cap).toBe(40)
    expect(stockCapFor(30).cap).toBe(60)
    expect(stockCapFor(40).cap).toBe(80)
  })
  it('기본 제안은 한 칸 낮고 0 아래로 내려가지 않는다', () => {
    expect(stockCapFor(30).recommended).toBe(40)
    expect(stockCapFor(5).cap).toBe(0)
    expect(stockCapFor(5).recommended).toBe(0)
  })
})

describe('필요 월 적립액', () => {
  it('목표 3억·20년이 연구 결과(보통 56만, 8/10 86만, 9/10 107만, 적금 119만)와 비슷하다', () => {
    const r = requiredMonthly(300_000_000, 20)!
    expect(r.median / 10_000).toBeGreaterThan(50)
    expect(r.median / 10_000).toBeLessThan(62)
    expect(r.eightOfTen / 10_000).toBeGreaterThan(78)
    expect(r.eightOfTen / 10_000).toBeLessThan(94)
    expect(r.nineOfTen / 10_000).toBeGreaterThan(98)
    expect(r.nineOfTen / 10_000).toBeLessThan(116)
    expect(r.savings / 10_000).toBeGreaterThan(114)
    expect(r.savings / 10_000).toBeLessThan(124)
  })
  it('나쁜 운일수록 더 많이 필요하다', () => {
    const r = requiredMonthly(200_000_000, 15)!
    expect(r.median).toBeLessThan(r.eightOfTen)
    expect(r.eightOfTen).toBeLessThan(r.nineOfTen)
  })
  it('기간이 너무 짧거나 목표가 없으면 null', () => {
    expect(requiredMonthly(0, 20)).toBeNull()
    expect(requiredMonthly(100_000_000, 3)).toBeNull()
  })
})

describe('은퇴 인출', () => {
  it('실패율은 표 사이를 직선으로 잇고 단조 증가한다', () => {
    expect(withdrawalFailure(3, 30)).toBe(0)
    expect(withdrawalFailure(4, 30)).toBe(5)
    expect(withdrawalFailure(4.3, 30)).toBeGreaterThan(5)
    expect(withdrawalFailure(5, 25)).toBeGreaterThan(withdrawalFailure(4.5, 25))
  })
  it('연금만으로 목표를 채우면 계좌에서 꺼낼 돈이 없다', () => {
    const p = planWithdrawal({ assetsWon: 180_000_000, targetNetMonthlyWon: 1_000_000, publicPensionMonthlyWon: 1_200_000, insurance: 'dependent', propertyBaseWon: 0 })!
    expect(p.withdrawMonthly).toBe(0)
    expect(p.fail30).toBe(0)
  })
  it('1.8억에서 세금·건보료 뒤 월 100만원을 쥐려면 100만원보다 더 꺼내야 한다', () => {
    const p = planWithdrawal({ assetsWon: 180_000_000, targetNetMonthlyWon: 1_000_000, publicPensionMonthlyWon: 0, insurance: 'regional', propertyBaseWon: 300_000_000 })!
    expect(p.withdrawMonthly).toBeGreaterThan(1_000_000)
    expect(p.netMonthly).toBeGreaterThanOrEqual(1_000_000)
    expect(p.withdrawRange[1]).toBeGreaterThanOrEqual(p.withdrawRange[0])
  })
  it('목표가 너무 크면 unreachable', () => {
    const p = planWithdrawal({ assetsWon: 10_000_000, targetNetMonthlyWon: 3_000_000, publicPensionMonthlyWon: 0, insurance: 'regional', propertyBaseWon: 0 })!
    expect(p.unreachable).toBe(true)
  })
  it('입력이 비면 null', () => {
    expect(planWithdrawal({ assetsWon: 0, targetNetMonthlyWon: 500_000, publicPensionMonthlyWon: 0, insurance: 'regional', propertyBaseWon: 0 })).toBeNull()
  })
})

describe('인컴 슬리브 비용', () => {
  it('비중이 커질수록 끝 자산 비율이 줄고 표 사이는 직선', () => {
    expect(sleeveCost(0)).toBe(100)
    expect(sleeveCost(30)).toBe(85)
    expect(sleeveCost(100)).toBe(50)
    expect(sleeveCost(80)).toBeLessThan(sleeveCost(40))
  })
})
