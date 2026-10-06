import { describe, expect, it } from 'vitest'
import { creditRate, planTaxShelter } from './taxShelter'

describe('연금계좌 세액공제', () => {
  it('900만원을 다 넣으면 낮은 구간 148.5만원, 높은 구간 118.8만원', () => {
    expect(planTaxShelter({ band: 'low', pensionSavingWon: 6_000_000, irpWon: 3_000_000 }).refundWon).toBe(1_485_000)
    expect(planTaxShelter({ band: 'high', pensionSavingWon: 6_000_000, irpWon: 3_000_000 }).refundWon).toBe(1_188_000)
  })

  it('연금저축 700만원은 600만원까지만 인정되고 넘은 100만원은 공제 못 받는다', () => {
    const p = planTaxShelter({ band: 'low', pensionSavingWon: 7_000_000, irpWon: 0 })
    expect(p.eligibleWon).toBe(6_000_000)
    expect(p.overLimitWon).toBe(1_000_000)
    expect(p.extraRefundPossibleWon).toBe(Math.round(3_000_000 * 0.165))
  })

  it('합산 한도 900만원을 넘겨도 환급은 더 늘지 않는다', () => {
    const p = planTaxShelter({ band: 'low', pensionSavingWon: 6_000_000, irpWon: 5_000_000 })
    expect(p.eligibleWon).toBe(9_000_000)
    expect(p.overLimitWon).toBe(2_000_000)
  })

  it('넣은 돈이 없으면 환급도 즉시 수익률도 0', () => {
    const p = planTaxShelter({ band: 'low', pensionSavingWon: 0, irpWon: 0 })
    expect(p.refundWon).toBe(0)
    expect(p.immediateReturnPct).toBe(0)
  })

  it('한도 안에서는 넣은 금액 대비 환급률이 공제율과 같다', () => {
    expect(planTaxShelter({ band: 'high', pensionSavingWon: 3_000_000, irpWon: 0 }).immediateReturnPct).toBeCloseTo(13.2, 5)
    expect(creditRate('low')).toBe(0.165)
  })
})

import { compareAccounts } from './taxShelter'

describe('일반 계좌 vs 연금계좌', () => {
  const base = { band: 'low' as const, yearlyWon: 6_000_000, years: 10, grossReturn: 0.06 }

  it('분배율이 높을수록 연금계좌 쪽 이득이 커진다', () => {
    const idx = compareAccounts({ ...base, distYield: 0.015 })
    const cc = compareAccounts({ ...base, distYield: 0.12 })
    expect(cc.diffWon).toBeGreaterThan(idx.diffWon)
    expect(idx.diffWon).toBeGreaterThan(0)
  })

  it('수익률 0%이면 이득은 환급(16.5%)에서 연금소득세(5.5%)를 뺀 만큼 남는다', () => {
    const r = compareAccounts({ ...base, grossReturn: 0, distYield: 0 })
    expect(r.generalWon).toBe(60_000_000)
    expect(r.pensionWon).toBeGreaterThan(60_000_000)
    expect(r.diffWon).toBeCloseTo(60_000_000 * (0.165 - 0.055), -4)
  })

  it('납입 0이면 모두 0', () => {
    expect(compareAccounts({ ...base, yearlyWon: 0, distYield: 0.05 }).pensionWon).toBe(0)
  })
})
