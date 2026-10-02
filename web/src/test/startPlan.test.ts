import { describe, expect, it } from 'vitest'
import {
  futureValue,
  judgeRealism,
  loanAdvice,
  monthlySurplus,
  realisticOutcome,
  requiredAnnualPct,
  suggestMonthly,
  targetWealth,
  yearsToTarget,
} from '../lib/startPlan'

describe('시작 마법사 계산', () => {
  it('여유액은 수입에서 카드값·고정지출·대출 상환을 뺀 값이고 적자도 그대로 보여준다', () => {
    expect(monthlySurplus({ income: 3_500_000, card: 800_000, otherFixed: 1_000_000, loanPayment: 500_000 })).toBe(1_200_000)
    expect(monthlySurplus({ income: 2_000_000, card: 1_500_000, otherFixed: 600_000, loanPayment: 0 })).toBe(-100_000)
  })

  it('제안 적립액은 여유액의 절반을 1만원 단위로 내림하고 적자면 0', () => {
    expect(suggestMonthly(1_234_567)).toBe(610_000)
    expect(suggestMonthly(-5)).toBe(0)
  })

  it('복리 미래가치: 수익률 0이면 단순 합계, 8%면 이보다 크다', () => {
    expect(futureValue(1_000_000, 100_000, 1, 0)).toBe(2_200_000)
    expect(futureValue(1_000_000, 100_000, 10, 8)).toBeGreaterThan(1_000_000 + 100_000 * 120)
  })

  it('필요 연수익률을 역산하면 그 수익률로 목표에 닿는다', () => {
    const target = targetWealth(500_000) // 월 50만원 → 1.5억
    expect(target).toBe(150_000_000)
    const pct = requiredAnnualPct({ seed: 1_000_000, monthly: 300_000, years: 10, target })
    expect(pct).not.toBeNull()
    expect(futureValue(1_000_000, 300_000, 10, pct as number)).toBeGreaterThanOrEqual(target - 1)
    expect(futureValue(1_000_000, 300_000, 10, (pct as number) - 0.5)).toBeLessThan(target)
  })

  it('이미 닿는 목표는 0, 어떤 수익률로도 안 닿으면 null', () => {
    expect(requiredAnnualPct({ seed: 10_000_000, monthly: 0, years: 1, target: 5_000_000 })).toBe(0)
    expect(requiredAnnualPct({ seed: 0, monthly: 10_000, years: 1, target: 1e12 })).toBeNull()
  })

  it('현실성 판정은 지수 장기 평균 기준으로 3단계', () => {
    expect(judgeRealism(6).level).toBe('ok')
    expect(judgeRealism(12).level).toBe('stretch')
    expect(judgeRealism(38).level).toBe('unrealistic')
    expect(judgeRealism(null).level).toBe('unrealistic')
  })

  it('장기 평균 수익률 결과와 목표 도달 햇수', () => {
    const out = realisticOutcome({ initialSeed: 1_000_000, monthly: 300_000, years: 10 })
    expect(out.monthlyIncome).toBeCloseTo((out.wealth * 0.04) / 12, 5)
    const years = yearsToTarget({ initialSeed: 1_000_000, monthly: 300_000, target: 150_000_000 })
    expect(years).not.toBeNull()
    expect(yearsToTarget({ initialSeed: 0, monthly: 0, target: 1e9 })).toBeNull()
  })

  it('대출 금리가 기대수익보다 높을 때만 상환 먼저 안내', () => {
    expect(loanAdvice(4)).toBeNull()
    expect(loanAdvice(null)).toBeNull()
    expect(loanAdvice(11)).toContain('먼저')
  })
})
