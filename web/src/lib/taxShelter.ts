/**
 * 연금계좌(연금저축·IRP) 세액공제 계산 — 투자 수익과 별개로 '넣는 순간' 생기는 환급을 숫자로 보여준다.
 * 순수 함수만 둔다. 세법은 해마다 바뀌므로 기준 연도와 확인 상태를 상수로 남긴다.
 *
 * 확인(2026-10-07 웹 검색에서 여러 자료가 일치, 국세청 원문은 직접 확인 못 함):
 *  - 연금저축 세액공제 납입 한도 연 600만원, 연금저축+IRP 합산 연 900만원
 *  - 공제율: 총급여 5,500만원 이하(종합소득 4,500만원 이하) 16.5%, 초과 13.2% (지방소득세 포함)
 *  - 900만원을 모두 넣으면 환급 최대 148.5만원(16.5%) / 118.8만원(13.2%)
 * 제외·주의: 총급여 1.2억 초과(종합소득 1억 초과) 구간은 연금저축 한도가 줄어든다. 연금으로 받을 때는 연금소득세가 붙고,
 * 55세 이전에 해지하거나 세액공제 받은 금액과 수익을 일시 인출하면 기타소득세(16.5%)가 붙는다. 한도·율은 가입 전 확인.
 * ISA(3년 의무 가입, 순이익 일정액 비과세 후 9.9% 분리과세)는 2026년 한도 개편이 논의 중이라 숫자를 넣지 않았다.
 */
export const TAX_RULES_YEAR = 2026
export const PENSION_SAVING_LIMIT_WON = 6_000_000
export const PENSION_TOTAL_LIMIT_WON = 9_000_000
export const CREDIT_RATE_LOW = 0.165
export const CREDIT_RATE_HIGH = 0.132
/** 총급여 이 금액 이하면 낮은 구간 공제율(종합소득 기준은 4,500만원) */
export const LOW_INCOME_SALARY_LIMIT_WON = 55_000_000
export const EARLY_WITHDRAWAL_TAX_RATE = 0.165

export type IncomeBand = 'low' | 'high'

export function creditRate(band: IncomeBand): number {
  return band === 'low' ? CREDIT_RATE_LOW : CREDIT_RATE_HIGH
}

export type TaxShelterInput = {
  band: IncomeBand
  /** 올해 연금저축에 넣는(넣은) 금액 */
  pensionSavingWon: number
  /** 올해 IRP에 넣는(넣은) 금액 */
  irpWon: number
}

export type TaxShelterPlan = {
  /** 공제 대상으로 인정되는 금액 (한도 안) */
  eligibleWon: number
  refundWon: number
  /** 한도 때문에 공제를 못 받는 금액 */
  overLimitWon: number
  /** 한도까지 더 넣으면 추가로 받을 수 있는 환급 */
  extraRefundPossibleWon: number
  /** 넣은 금액 대비 환급률(%) — 투자 수익과 별개로 생기는 즉시 수익 */
  immediateReturnPct: number
}

export function planTaxShelter(i: TaxShelterInput): TaxShelterPlan {
  const saving = Math.max(0, Math.round(i.pensionSavingWon))
  const irp = Math.max(0, Math.round(i.irpWon))
  const savingEligible = Math.min(saving, PENSION_SAVING_LIMIT_WON)
  // IRP는 연금저축에서 못 채운 한도까지 포함해 합산 900만원 안에서 인정된다
  const eligibleWon = Math.min(savingEligible + irp, PENSION_TOTAL_LIMIT_WON)
  const rate = creditRate(i.band)
  const refundWon = Math.round(eligibleWon * rate)
  const paid = saving + irp
  const roomLeft = Math.max(0, PENSION_TOTAL_LIMIT_WON - eligibleWon)
  return {
    eligibleWon,
    refundWon,
    overLimitWon: Math.max(0, paid - eligibleWon),
    extraRefundPossibleWon: Math.round(roomLeft * rate),
    immediateReturnPct: paid > 0 ? (refundWon / paid) * 100 : 0,
  }
}

export const DIVIDEND_TAX_RATE = 0.154
/** 연금 수령 시 연금소득세(만 55~69세 5.5% 가정, 나이가 많을수록 낮아짐) */
export const PENSION_PAYOUT_TAX_RATE = 0.055

export type AccountCompareInput = {
  band: IncomeBand
  /** 매년 초 넣는 금액 */
  yearlyWon: number
  years: number
  /** 연 총수익률(가격+분배금), 예 0.06 */
  grossReturn: number
  /** 이 중 분배금으로 나오는 비율, 예 0.015(지수형)·0.05(고배당)·0.12(커버드콜) */
  distYield: number
}

export type AccountCompare = {
  /** 일반 계좌에만 넣었을 때 마지막 평가액(국내 주식형 ETF: 매매차익 비과세, 분배금만 15.4%) */
  generalWon: number
  /** 연금계좌(과세이연) 평가액에서 연금소득세를 뺀 값 + 환급을 일반 계좌에 같은 방식으로 굴린 값 */
  pensionWon: number
  diffWon: number
  totalPaidWon: number
}

/**
 * 같은 돈을 일반 계좌에 두는 경우와 연금계좌(연금저축·IRP)에 넣는 경우의 세후 마지막 평가액.
 * 가정: 국내 상장 주식형 ETF(매매차익 비과세, 분배금 15.4%), 분배금은 재투자, 연금은 5.5%로 전액 수령,
 * 세액공제 한도(900만원) 안의 납입분만 환급(환급은 일반 계좌에 같은 자산으로 재투자). 해외·채권 ETF는 매매차익도 과세라 연금계좌 이득이 더 크다.
 */
export function compareAccounts(i: AccountCompareInput): AccountCompare {
  const d = Math.min(Math.max(i.distYield, 0), Math.max(i.grossReturn, 0))
  const price = i.grossReturn - d
  const generalStep = 1 + price + d * (1 - DIVIDEND_TAX_RATE)
  const pensionStep = 1 + i.grossReturn
  const eligible = Math.min(Math.max(i.yearlyWon, 0), PENSION_TOTAL_LIMIT_WON)
  const refund = eligible * creditRate(i.band)
  let general = 0
  let pension = 0
  let refundWealth = 0
  for (let y = 0; y < i.years; y += 1) {
    general = (general + i.yearlyWon) * generalStep
    pension = (pension + i.yearlyWon) * pensionStep
    // 환급은 다음 해 초에 받는다고 보고 한 해 늦게 굴린다
    refundWealth = (refundWealth + (y > 0 ? refund : 0)) * generalStep
  }
  // 마지막 해 환급은 평가 시점에 현금으로 받는다
  if (i.years > 0) refundWealth += refund
  const pensionNet = pension * (1 - PENSION_PAYOUT_TAX_RATE)
  const pensionTotal = pensionNet + refundWealth
  return {
    generalWon: Math.round(general),
    pensionWon: Math.round(pensionTotal),
    diffWon: Math.round(pensionTotal - general),
    totalPaidWon: Math.round(i.yearlyWon * i.years),
  }
}
