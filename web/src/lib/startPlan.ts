/**
 * 시작 마법사 계산 — 수입·지출·대출로 월 투자 여유액을 구하고, 목표가 현실적인지 필요 연수익률로 되짚는다.
 * 순수 함수만 둔다(화면·서버 호출 없음). 목표 필요 시드는 목표 트래커와 같은 인출률 식을 쓴다.
 */
import { requiredSeed, DEFAULT_WITHDRAWAL_PCT } from '../../../src/services/goalTracker'

/** 지수 장기 평균(참고) — 이보다 높은 수익률을 요구하면 비현실적이라고 안내한다 */
export const REALISTIC_ANNUAL_PCT = 8
export const STRETCH_ANNUAL_PCT = 15

export type StartInputs = {
  income: number
  card: number
  otherFixed: number
  loanPayment: number
  /** 대출 연이율 % (모르면 null) */
  loanRatePct: number | null
  years: number
  /** 원하는 월 수입(투자로 받고 싶은 금액) */
  targetMonthly: number
  /** 시작할 때 넣을 금액 */
  initialSeed: number
  /** 매달 적립할 금액 */
  monthly: number
}

/** 월 수입 − 카드값 − 그 밖의 고정지출 − 대출 상환 */
export function monthlySurplus(i: Pick<StartInputs, 'income' | 'card' | 'otherFixed' | 'loanPayment'>): number {
  return Math.round(i.income - i.card - i.otherFixed - i.loanPayment)
}

/** 여유액의 절반을 1만원 단위로 내림 — 남는 돈을 전부 쓰지 않는 보수적 제안 */
export function suggestMonthly(surplus: number): number {
  if (!(surplus > 0)) return 0
  return Math.floor((surplus * 0.5) / 10_000) * 10_000
}

/** 월말 적립 복리 미래가치 */
export function futureValue(seed: number, monthly: number, years: number, annualPct: number): number {
  const n = Math.round(years * 12)
  if (n <= 0) return seed
  const m = (1 + annualPct / 100) ** (1 / 12) - 1
  if (m === 0) return seed + monthly * n
  const g = (1 + m) ** n
  return seed * g + (monthly * (g - 1)) / m
}

/** 필요한 총 시드 — 원금을 지키며 목표 월 수입을 꺼내 쓰는 규모 */
export function targetWealth(targetMonthly: number): number {
  return requiredSeed(targetMonthly, DEFAULT_WITHDRAWAL_PCT)
}

/**
 * 시작금·월 적립으로 기간 안에 목표 자산에 닿기 위한 연수익률(%).
 * 0%로도 닿으면 0, 200%로도 안 닿으면 null.
 */
export function requiredAnnualPct(input: { seed: number; monthly: number; years: number; target: number }): number | null {
  const { seed, monthly, years, target } = input
  if (!(target > 0)) return 0
  if (futureValue(seed, monthly, years, 0) >= target) return 0
  if (futureValue(seed, monthly, years, 200) < target) return null
  let lo = 0
  let hi = 200
  for (let k = 0; k < 60; k += 1) {
    const mid = (lo + hi) / 2
    if (futureValue(seed, monthly, years, mid) >= target) hi = mid
    else lo = mid
  }
  return hi
}

export type Realism = { level: 'ok' | 'stretch' | 'unrealistic'; text: string }

export function judgeRealism(requiredPct: number | null): Realism {
  if (requiredPct === null || requiredPct > STRETCH_ANNUAL_PCT) {
    return {
      level: 'unrealistic',
      text: requiredPct === null
        ? '이 조건으로는 어떤 수익률로도 닿기 어렵습니다.'
        : `연 ${requiredPct.toFixed(0)}%가 필요합니다. 지수의 장기 평균은 연 ${REALISTIC_ANNUAL_PCT}% 안팎이라 사실상 어려운 목표입니다.`,
    }
  }
  if (requiredPct > REALISTIC_ANNUAL_PCT) {
    return { level: 'stretch', text: `연 ${requiredPct.toFixed(1)}%가 필요합니다. 지수 장기 평균(연 ${REALISTIC_ANNUAL_PCT}% 안팎)보다 높아 빠듯한 목표입니다.` }
  }
  return { level: 'ok', text: `연 ${requiredPct.toFixed(1)}% 정도면 닿습니다. 지수 장기 평균 범위 안이라 현실적인 목표입니다.` }
}

/** 지금 조건 그대로 장기 평균 수익률(8%)이면 기간 뒤 얼마가 되고 월 수입은 얼마인가 */
export function realisticOutcome(i: Pick<StartInputs, 'initialSeed' | 'monthly' | 'years'>): { wealth: number; monthlyIncome: number } {
  const wealth = futureValue(i.initialSeed, i.monthly, i.years, REALISTIC_ANNUAL_PCT)
  return { wealth, monthlyIncome: (wealth * (DEFAULT_WITHDRAWAL_PCT / 100)) / 12 }
}

/** 지금 적립액으로 장기 평균 수익률이면 목표 자산까지 걸리는 햇수. 50년 넘으면 null */
export function yearsToTarget(i: Pick<StartInputs, 'initialSeed' | 'monthly'> & { target: number }): number | null {
  for (let months = 1; months <= 600; months += 1) {
    if (futureValue(i.initialSeed, i.monthly, months / 12, REALISTIC_ANNUAL_PCT) >= i.target) return Math.ceil(months / 12)
  }
  return null
}

/** 대출 이자가 기대수익(8%)보다 높으면 투자보다 상환이 먼저라는 안내 */
export function loanAdvice(loanRatePct: number | null): string | null {
  if (loanRatePct == null || !(loanRatePct > REALISTIC_ANNUAL_PCT)) return null
  return `대출 금리 연 ${loanRatePct}%는 투자 기대수익(연 ${REALISTIC_ANNUAL_PCT}% 안팎)보다 높습니다. 상환이 확실한 수익이라, 이 대출을 먼저 줄이는 쪽을 권합니다.`
}

export type LossReaction = 'sell' | 'hold' | 'buy'

export function lossReactionNote(reaction: LossReaction): string {
  if (reaction === 'sell') return '하락이 불안하면 종목 매매보다 지수(KODEX 200) 보유 방식이 맞고, 처음엔 적은 금액으로 가상 계좌에서 하락을 겪어 보는 걸 권합니다.'
  if (reaction === 'buy') return '하락을 기회로 보는 성향이라도 정해진 적립액을 넘겨 더 넣지는 마세요. 규칙대로만 넣는 게 행동 편향을 막습니다.'
  return '하락에도 버티는 성향이면 정기 적립과 잘 맞습니다. 그대로 규칙을 따르면 됩니다.'
}
