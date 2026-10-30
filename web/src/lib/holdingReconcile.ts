/**
 * 증권사 앱의 새 수량·평단을 기록된 보유와 맞춰 보고, 모자란 매수를 역산한다.
 * 추가분 단가 = (새 수량 × 새 평단 − 현재 투입금액) ÷ 추가 수량. 개별 체결가가 아니라 그 구간의 평균이다.
 */

export type ReconcileCurrent = {
  quantity: number
  /** 기록된 투입금액(없으면 수량 × 평단으로 대신한다) */
  investedAmount?: number | null
  avgPrice: number
}

export type ReconcileResult =
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'same' }
  /** 수량은 같은데 평단만 다름 — 수수료 포함 방식 차이 등. 기록하지 않는다 */
  | { kind: 'avgOnly'; gap: number }
  /** 수량이 줄었음 — 매도로 기록해야 한다(매도는 평단을 바꾸지 않아 역산이 안 된다) */
  | { kind: 'sell'; lessQty: number }
  | {
    kind: 'buy'
    addQty: number
    /** 추가분 평균 단가(소수점 그대로 — 이 값으로 기록해야 기록 뒤 평단이 입력한 평단과 맞는다) */
    unitPrice: number
    addAmount: number
    prevAvg: number
    /** 추가분 단가 − 이전 평단 */
    gapPerShare: number
    /** 증권사 평단 반올림 때문에 단가에 생길 수 있는 오차(±원) */
    tolerance: number
    warnings: string[]
  }

const MAX_PRICE_DEVIATION = 0.3

export function reconcileHolding(
  current: ReconcileCurrent,
  newQty: number | null | undefined,
  newAvg: number | null | undefined,
  refClose?: number | null,
): ReconcileResult {
  const qtyBlank = newQty == null || Number.isNaN(newQty)
  const avgBlank = newAvg == null || Number.isNaN(newAvg)
  if (qtyBlank && avgBlank) return { kind: 'empty' }
  if (qtyBlank || avgBlank) return { kind: 'invalid', reason: '새 수량과 새 평단을 둘 다 적어 주세요' }
  const qty = Number(newQty)
  const avg = Number(newAvg)
  if (!Number.isInteger(qty) || qty <= 0) return { kind: 'invalid', reason: '수량은 1 이상의 정수여야 합니다' }
  if (!(avg > 0)) return { kind: 'invalid', reason: '평단은 0보다 커야 합니다' }
  if (!(current.quantity > 0)) return { kind: 'invalid', reason: '기록된 수량이 없어 맞출 수 없습니다' }

  const prevInvested = current.investedAmount != null && current.investedAmount > 0
    ? current.investedAmount
    : current.quantity * current.avgPrice
  const prevAvg = prevInvested / current.quantity

  if (qty < current.quantity) return { kind: 'sell', lessQty: current.quantity - qty }
  if (qty === current.quantity) {
    const gap = avg - prevAvg
    return Math.abs(gap) < 1 ? { kind: 'same' } : { kind: 'avgOnly', gap }
  }

  const addQty = qty - current.quantity
  const addAmount = qty * avg - prevInvested
  if (addAmount <= 0) {
    return { kind: 'invalid', reason: '평단이 내려가 추가 매수로 설명되지 않습니다(분배금 반영·수정주가·입력 오류 확인)' }
  }
  const unitPrice = addAmount / addQty
  const tolerance = (0.5 * qty) / addQty
  const warnings: string[] = []
  if (refClose != null && refClose > 0 && (unitPrice > refClose * (1 + MAX_PRICE_DEVIATION) || unitPrice < refClose * (1 - MAX_PRICE_DEVIATION))) {
    warnings.push(`최근 종가(${Math.round(refClose).toLocaleString('ko-KR')}원)와 ±30% 넘게 달라 서버가 거절합니다`)
  } else if (tolerance > unitPrice * 0.02) {
    warnings.push('추가 수량이 적어 평단 반올림만으로도 단가가 꽤 달라질 수 있습니다')
  }
  return { kind: 'buy', addQty, unitPrice, addAmount, prevAvg, gapPerShare: unitPrice - prevAvg, tolerance, warnings }
}

/** 모아서 기록한 추정 매수를 구분하는 메모 접두어 — 패턴 분석에서 건별 기록과 나누는 기준 */
export const BULK_ESTIMATE_MEMO = 'bulk-estimate'
