import { describe, expect, it } from 'vitest'
import { ccDownturnCase, ratesLabels, incomePlan, isFactStale, planWithdrawal, requiredMonthly, sleeveCost, stockCapFor, withdrawalFailure } from './planGuide'

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
    expect(sleeveCost(30)).toBeGreaterThan(sleeveCost(40))
    expect(sleeveCost(30)).toBeLessThan(sleeveCost(20))
    expect(sleeveCost(100)).toBeLessThan(60)
    expect(sleeveCost(80)).toBeLessThan(sleeveCost(40))
  })
})

describe('자료 기준 표시', () => {
  it('만든 지 180일이 넘으면 낡은 자료, 날짜가 아니면 낡음 아님', () => {
    const today = new Date('2027-01-01')
    expect(isFactStale('2026-10-03', today)).toBe(false)
    expect(isFactStale('2026-05-01', today)).toBe(true)
    expect(isFactStale('화면에서 계산', today)).toBe(false)
  })
})

describe('인컴 계좌 점검', () => {
  it('커버드콜 비중이 높을수록 분배율과 월 분배금이 커진다', () => {
    const a = incomePlan({ principalWon: 100_000_000, ccSharePct: 0, targetNetMonthlyWon: 500_000 })!
    const b = incomePlan({ principalWon: 100_000_000, ccSharePct: 100, targetNetMonthlyWon: 500_000 })!
    expect(b.typical.grossMonthly).toBeGreaterThan(a.typical.grossMonthly)
    expect(a.low.grossMonthly).toBeLessThan(a.typical.grossMonthly)
    expect(a.typical.grossMonthly).toBeLessThan(a.high.grossMonthly)
  })
  it('세후는 세전의 84.6%이고 목표에 모자라면 모자라는 비율을 준다', () => {
    const p = incomePlan({ principalWon: 50_000_000, ccSharePct: 50, targetNetMonthlyWon: 1_000_000 })!
    expect(p.typical.netMonthly / p.typical.grossMonthly).toBeCloseTo(0.846, 3)
    expect(p.shortfallLowPct).toBeGreaterThan(0)
  })
  it('목표를 채우는 원금과 연 분배금 경계를 알려 준다', () => {
    const p = incomePlan({ principalWon: 400_000_000, ccSharePct: 100, targetNetMonthlyWon: 500_000 })!
    expect(p.principalForTarget).toBeGreaterThan(0)
    expect(p.over20m).toBe(true)
    expect(incomePlan({ principalWon: 0, ccSharePct: 50, targetNetMonthlyWon: 500_000 })).toBeNull()
  })
})

describe('금리 환경 이름', () => {
  it('단기 ±1%p, 장기 ±0.5%p, 금리차 0·1%p 기준으로 나눈다', () => {
    expect(ratesLabels({ short: 4, long: 5.3, spread: 1.3, shortChg12: 0.3, longChg12: 1.2 })).toEqual({ short: '횡보', long: '상승', curve: '정상' })
    expect(ratesLabels({ short: 5.3, long: 4.2, spread: -1.1, shortChg12: 1.5, longChg12: 0.2 })).toEqual({ short: '인상기', long: '횡보', curve: '역전' })
    expect(ratesLabels({ short: 2, long: 2.5, spread: 0.5, shortChg12: -1.5, longChg12: -0.8 })).toEqual({ short: '인하기', long: '하락', curve: '평탄' })
  })
  it('커버드콜 유형을 바꾸면 분배율 범위가 달라진다', () => {
    const g1 = incomePlan({ principalWon: 100_000_000, ccSharePct: 100, targetNetMonthlyWon: 500_000, ccType: 'gen1' })!
    const g3 = incomePlan({ principalWon: 100_000_000, ccSharePct: 100, targetNetMonthlyWon: 500_000, ccType: 'gen3' })!
    expect(g3.typical.yieldPct).not.toBe(g1.typical.yieldPct)
  })
  it('커버드콜 하락 구간 환산은 원금이 줄고 분배금이 남는다', () => {
    const c = ccDownturnCase(50_000_000, 'gen2', 'crisis2008')
    expect(c.principalAfter).toBeLessThan(50_000_000)
    expect(c.netMonthly).toBeGreaterThan(0)
  })
})
