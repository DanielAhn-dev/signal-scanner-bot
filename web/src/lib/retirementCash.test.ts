import { describe, expect, it } from 'vitest'
import {
  dependentEligibility,
  estimatePropertyPoints,
  netCashPlan,
  pensionAccountTaxRate,
  regionalHealthPremium,
  rentalPropertyValue,
  voluntaryContinuationPremium,
} from './retirementCash'

describe('regionalHealthPremium', () => {
  it('공적연금은 50%만 소득으로 본다 — 연 1,200만원이면 월 소득 50만원 × 7.19%', () => {
    const p = regionalHealthPremium({ propertyBaseWon: 0, financialIncomeAnnualWon: 0, publicPensionAnnualWon: 12_000_000 })
    expect(p.incomeBaseMonthly).toBe(500_000)
    expect(p.income).toBe(35_950)
    expect(p.longTermCare).toBe(Math.round(35_950 * 0.1314))
    expect(p.property).toBe(0)
  })

  it('금융소득은 연 1,000만원 이하면 반영하지 않고, 넘으면 전액 반영한다', () => {
    expect(regionalHealthPremium({ propertyBaseWon: 0, financialIncomeAnnualWon: 10_000_000, publicPensionAnnualWon: 0 }).total).toBe(0)
    const over = regionalHealthPremium({ propertyBaseWon: 0, financialIncomeAnnualWon: 10_000_001, publicPensionAnnualWon: 0 })
    expect(over.incomeBaseMonthly).toBeCloseTo(10_000_001 / 12, -1)
  })

  it('재산은 기본공제 1억 이하면 부과되지 않고, 넘으면 점수 × 211.5원', () => {
    expect(regionalHealthPremium({ propertyBaseWon: 100_000_000, financialIncomeAnnualWon: 0, publicPensionAnnualWon: 0 }).property).toBe(0)
    const p = regionalHealthPremium({ propertyBaseWon: 104_500_000, financialIncomeAnnualWon: 0, publicPensionAnnualWon: 0 })
    expect(p.propertyPoints).toBe(22)
    expect(p.property).toBe(Math.round(22 * 211.5))
  })

  it('재산이 클수록 보험료가 단조 증가한다', () => {
    let prev = -1
    for (const base of [150_000_000, 300_000_000, 600_000_000, 1_500_000_000, 9_000_000_000]) {
      const v = regionalHealthPremium({ propertyBaseWon: base, financialIncomeAnnualWon: 0, publicPensionAnnualWon: 0 }).total
      expect(v).toBeGreaterThan(prev)
      prev = v
    }
  })
})

describe('estimatePropertyPoints', () => {
  it('원문으로 확인한 1·2·60등급 값과 맞는다', () => {
    expect(estimatePropertyPoints(4_500_000)).toBe(22)
    expect(estimatePropertyPoints(9_000_000)).toBe(44)
    expect(estimatePropertyPoints(7_800_000_000)).toBe(2_341)
  })
})

describe('voluntaryContinuationPremium', () => {
  it('월 보수 300만원이면 7.19% + 장기요양 13.14%', () => {
    expect(voluntaryContinuationPremium(3_000_000)).toBe(Math.round(215_700 + 215_700 * 0.1314))
  })
  it('재산 없는 지역가입자(연금 월 100만원)보다 비싸다', () => {
    const regional = regionalHealthPremium({ propertyBaseWon: 0, financialIncomeAnnualWon: 0, publicPensionAnnualWon: 12_000_000 }).total
    expect(voluntaryContinuationPremium(3_000_000)).toBeGreaterThan(regional)
  })
})

describe('rentalPropertyValue', () => {
  it('(보증금 + 월세×40) × 30%', () => {
    expect(rentalPropertyValue(50_000_000, 500_000)).toBe((50_000_000 + 20_000_000) * 0.3)
  })
})

describe('dependentEligibility', () => {
  it('소득 2,000만원 이하·재산 5.4억 이하면 가능', () => {
    expect(dependentEligibility({ financialIncomeAnnualWon: 3_000_000, publicPensionAnnualWon: 12_000_000, propertyBaseWon: 300_000_000 }).eligible).toBe(true)
  })
  it('공적연금 + 금융소득이 2,000만원을 넘으면 탈락', () => {
    expect(dependentEligibility({ financialIncomeAnnualWon: 12_000_000, publicPensionAnnualWon: 12_000_000, propertyBaseWon: 100_000_000 }).eligible).toBe(false)
  })
  it('재산 5.4억 초과는 소득 1,000만원 이하만, 9억 초과는 무조건 탈락', () => {
    expect(dependentEligibility({ financialIncomeAnnualWon: 0, publicPensionAnnualWon: 8_000_000, propertyBaseWon: 700_000_000 }).eligible).toBe(true)
    expect(dependentEligibility({ financialIncomeAnnualWon: 0, publicPensionAnnualWon: 12_000_000, propertyBaseWon: 700_000_000 }).eligible).toBe(false)
    expect(dependentEligibility({ financialIncomeAnnualWon: 0, publicPensionAnnualWon: 0, propertyBaseWon: 900_000_001 }).eligible).toBe(false)
  })
})

describe('pensionAccountTaxRate', () => {
  it('나이별 5.5·4.4·3.3%', () => {
    expect(pensionAccountTaxRate(65)).toBe(0.055)
    expect(pensionAccountTaxRate(70)).toBe(0.044)
    expect(pensionAccountTaxRate(80)).toBe(0.033)
  })
})

describe('netCashPlan', () => {
  const base = { monthlyFromAssetsWon: 600_000, distributionAnnualWon: 3_600_000, publicPensionMonthlyWon: 1_000_000, propertyBaseWon: 0 }

  it('지역가입자는 보험료와 분배금 세금이 실수령에서 빠진다', () => {
    const r = netCashPlan({ ...base, insurance: 'regional' })
    expect(r.grossMonthly).toBe(1_600_000)
    expect(r.dividendTaxMonthly).toBe(Math.round((3_600_000 * 0.154) / 12))
    expect(r.healthMonthly).toBeGreaterThan(0)
    expect(r.netMonthly).toBe(r.grossMonthly - r.dividendTaxMonthly - r.healthMonthly)
  })

  it('피부양자 요건을 만족하면 건강보험료가 0이다', () => {
    const r = netCashPlan({ ...base, insurance: 'dependent' })
    expect(r.dependent?.eligible).toBe(true)
    expect(r.healthMonthly).toBe(0)
  })

  it('피부양자 요건을 어기면 지역가입자 보험료로 되돌아간다', () => {
    const r = netCashPlan({ ...base, publicPensionMonthlyWon: 2_000_000, insurance: 'dependent' })
    expect(r.dependent?.eligible).toBe(false)
    expect(r.healthMonthly).toBeGreaterThan(0)
  })
})
