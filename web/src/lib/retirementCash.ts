/**
 * 은퇴 뒤 '실제로 손에 남는 현금' 추정 — 세금·건강보험료·피부양자 자격을 인출액에서 뺀다 (2026 기준).
 * 순수 함수만 둔다(화면·서버 호출 없음). 값은 모두 추정이며, 화면에는 범위·"공단 모의계산으로 확인"과 함께 보여준다.
 *
 * 출처 구분:
 *  - 확인(보건복지부 2026년 보험료율 결정 보도자료): 건강보험료율 7.19%, 재산 부과점수당 211.5원, 장기요양 0.9448%(= 건보료의 13.14%)
 *  - 여러 안내 자료가 일치(공식 원문은 직접 확인 못 함): 지역가입자 소득 반영 — 사업·이자·배당·기타 100%, 근로·연금 50%,
 *    금융소득은 연 1,000만원 초과일 때만 반영, 재산 기본공제 1억, 자동차 부과 폐지(2024-02), 피부양자 소득 2,000만원·재산 5.4억/9억
 *  - 근사: 재산 점수표(60등급)는 1·2·60등급만 원문으로 확인했고 중간 구간은 앵커 점 사이를 로그 보간한 값이다 → 재산 보험료는 ±10% 안팎 오차
 * 제외: 국민연금 소득세(연금소득공제 후 월 100만원 수준이면 연 수십만원 이하), 금융소득 2,000만원 초과 종합과세, 임의계속가입(직장 보수 기준 유지, 최대 36개월)
 */

export const HEALTH_RATE = 0.0719
export const LTC_RATE_OF_HEALTH = 0.1314
export const POINT_VALUE_WON = 211.5
export const PROPERTY_DEDUCTION_WON = 100_000_000
/** 금융소득 연 이 금액 이하이면 소득월액 산정·피부양자 소득 합산에서 제외 */
export const FINANCIAL_INCOME_FREE_WON = 10_000_000
export const DEPENDENT_INCOME_LIMIT_WON = 20_000_000
export const DEPENDENT_PROPERTY_LIMIT_WON = 540_000_000
export const DEPENDENT_PROPERTY_HARD_LIMIT_WON = 900_000_000
/** 5.4억 초과~9억 이하일 때 피부양자로 남으려면 연 소득이 이 이하여야 한다 */
export const DEPENDENT_INCOME_LIMIT_MID_PROPERTY_WON = 10_000_000
export const DIVIDEND_TAX_RATE = 0.154

/** [공제 후 재산(만원) 상한, 점수] — 1·2·60등급은 원문 확인, 나머지는 근사 앵커. 앵커 사이는 로그 보간 */
const PROPERTY_POINT_ANCHORS: Array<[number, number]> = [
  [450, 22], [900, 44], [4_500, 244], [14_500, 489], [46_900, 731], [778_124, 2_341],
]

/** 공제 후 재산(원)을 부과점수로 — 근사 */
export function estimatePropertyPoints(afterDeductionWon: number): number {
  const man = afterDeductionWon / 10_000
  if (!(man > 0)) return 0
  const first = PROPERTY_POINT_ANCHORS[0]
  if (man <= first[0]) return first[1]
  for (let i = 1; i < PROPERTY_POINT_ANCHORS.length; i += 1) {
    const [x0, y0] = PROPERTY_POINT_ANCHORS[i - 1]
    const [x1, y1] = PROPERTY_POINT_ANCHORS[i]
    if (man <= x1) {
      const t = i === 1 ? (man - x0) / (x1 - x0) : Math.log(man / x0) / Math.log(x1 / x0)
      return y0 + (y1 - y0) * t
    }
  }
  return PROPERTY_POINT_ANCHORS[PROPERTY_POINT_ANCHORS.length - 1][1]
}

/** 전월세 보증금·월세의 재산 반영액 — (보증금 + 월세×40) × 30% */
export function rentalPropertyValue(depositWon: number, monthlyRentWon: number): number {
  return Math.max(0, (depositWon + monthlyRentWon * 40) * 0.3)
}

export type RegionalInput = {
  /** 재산세 과세표준 합계(세대 단위) + 전월세 반영액. 자가 주택이면 대략 공시가격의 40~60% — 정확한 값은 재산세 고지서 */
  propertyBaseWon: number
  /** 이자·배당 연 합계. 원금을 팔아 쓰는 돈은 소득이 아니다 */
  financialIncomeAnnualWon: number
  publicPensionAnnualWon: number
  wageAnnualWon?: number
  businessAnnualWon?: number
}

export type HealthPremium = { income: number; property: number; longTermCare: number; total: number; incomeBaseMonthly: number; propertyPoints: number }

/** 지역가입자 세대의 월 건강보험료(장기요양 포함) 추정 */
export function regionalHealthPremium(i: RegionalInput): HealthPremium {
  const financial = i.financialIncomeAnnualWon > FINANCIAL_INCOME_FREE_WON ? i.financialIncomeAnnualWon : 0
  const base = (financial + (i.businessAnnualWon ?? 0) + 0.5 * i.publicPensionAnnualWon + 0.5 * (i.wageAnnualWon ?? 0)) / 12
  const income = base * HEALTH_RATE
  const points = estimatePropertyPoints(Math.max(0, i.propertyBaseWon - PROPERTY_DEDUCTION_WON))
  const property = points * POINT_VALUE_WON
  const health = income + property
  const longTermCare = health * LTC_RATE_OF_HEALTH
  return { income: Math.round(income), property: Math.round(property), longTermCare: Math.round(longTermCare), total: Math.round(health + longTermCare), incomeBaseMonthly: Math.round(base), propertyPoints: Math.round(points) }
}

/**
 * 퇴직 후 임의계속가입(최대 36개월) 월 보험료 추정 — 퇴직 전 12개월 평균 보수월액 기준, 재산 미반영.
 * 재직 때는 회사가 절반을 냈지만 임의계속가입은 전액 본인 부담이라 기준 보수가 크면 지역가입자보다 비쌀 수 있다(전액 본인 부담은 안내 자료 기준, 공식 원문 미확인).
 */
export function voluntaryContinuationPremium(avgMonthlyWageWon: number): number {
  const health = Math.max(0, avgMonthlyWageWon) * HEALTH_RATE
  return Math.round(health + health * LTC_RATE_OF_HEALTH)
}

export type DependentCheck ={ eligible: boolean; reason: string }

/**
 * 직장가입자(배우자·자녀 등)의 피부양자로 남을 수 있는가 — 부양 요건(가족 관계)은 따로 확인해야 한다.
 * 합산소득은 보수적으로 공적연금을 100% 반영한다(안내 자료에 따라 50%라는 설명도 있어 탈락 쪽으로 기울여 안내).
 */
export function dependentEligibility(i: { financialIncomeAnnualWon: number; publicPensionAnnualWon: number; otherIncomeAnnualWon?: number; propertyBaseWon: number }): DependentCheck {
  const financial = i.financialIncomeAnnualWon > FINANCIAL_INCOME_FREE_WON ? i.financialIncomeAnnualWon : 0
  const income = financial + i.publicPensionAnnualWon + (i.otherIncomeAnnualWon ?? 0)
  if (i.propertyBaseWon > DEPENDENT_PROPERTY_HARD_LIMIT_WON) return { eligible: false, reason: '재산세 과표 9억원 초과' }
  if (income > DEPENDENT_INCOME_LIMIT_WON) return { eligible: false, reason: '연 소득 2,000만원 초과' }
  if (i.propertyBaseWon > DEPENDENT_PROPERTY_LIMIT_WON && income > DEPENDENT_INCOME_LIMIT_MID_PROPERTY_WON) return { eligible: false, reason: '재산 5.4억 초과인데 연 소득 1,000만원 초과' }
  return { eligible: true, reason: '소득·재산 요건 안에 듭니다(부양 요건은 별도 확인)' }
}

/** 연금계좌(연금저축·IRP) 연금 수령 시 연금소득세율(지방세 포함) — 만 55세 이상, 연 1,500만원 이하 분리과세 기준 */
export function pensionAccountTaxRate(age: number): number {
  if (age >= 80) return 0.033
  if (age >= 70) return 0.044
  return 0.055
}

export type CashPlanInput = {
  /** 금융자산에서 매달 꺼내는 금액(세전). 이 중 분배금·이자 부분은 distributionAnnualWon */
  monthlyFromAssetsWon: number
  /** 위 인출 중 배당·이자소득으로 잡히는 연 금액 (국내 주식형 ETF 매도 차익은 비과세라 제외) */
  distributionAnnualWon: number
  /** 연금계좌에서 연금으로 꺼내는 월 금액 — 있으면 분배금 과세 대신 연금소득세(나이별)를 적용 */
  pensionAccountMonthlyWon?: number
  pensionAccountAge?: number
  publicPensionMonthlyWon: number
  propertyBaseWon: number
  insurance: 'regional' | 'dependent'
}

export type CashPlan = {
  grossMonthly: number
  dividendTaxMonthly: number
  pensionAccountTaxMonthly: number
  healthMonthly: number
  netMonthly: number
  /** 세금·보험료가 총 인출액에서 차지하는 비율(%) */
  leakagePct: number
  dependent: DependentCheck | null
}

/** 한 달에 들어오는 돈 − 세금·건강보험료 = 실제 쓸 수 있는 현금 */
export function netCashPlan(i: CashPlanInput): CashPlan {
  const pensionAccountMonthly = i.pensionAccountMonthlyWon ?? 0
  const gross = i.monthlyFromAssetsWon + i.publicPensionMonthlyWon + pensionAccountMonthly
  const dividendTax = (i.distributionAnnualWon * DIVIDEND_TAX_RATE) / 12
  const pensionTax = pensionAccountMonthly * pensionAccountTaxRate(i.pensionAccountAge ?? 65)
  const pensionAnnual = i.publicPensionMonthlyWon * 12
  let health = 0
  let dependent: DependentCheck | null = null
  if (i.insurance === 'dependent') {
    dependent = dependentEligibility({ financialIncomeAnnualWon: i.distributionAnnualWon, publicPensionAnnualWon: pensionAnnual, otherIncomeAnnualWon: pensionAccountMonthly * 12, propertyBaseWon: i.propertyBaseWon })
  }
  if (i.insurance === 'regional' || (dependent && !dependent.eligible)) {
    health = regionalHealthPremium({ propertyBaseWon: i.propertyBaseWon, financialIncomeAnnualWon: i.distributionAnnualWon, publicPensionAnnualWon: pensionAnnual + pensionAccountMonthly * 12 }).total
  }
  const net = gross - dividendTax - pensionTax - health
  return {
    grossMonthly: Math.round(gross), dividendTaxMonthly: Math.round(dividendTax), pensionAccountTaxMonthly: Math.round(pensionTax),
    healthMonthly: Math.round(health), netMonthly: Math.round(net), leakagePct: gross > 0 ? Math.round(((gross - net) / gross) * 1000) / 10 : 0, dependent,
  }
}
