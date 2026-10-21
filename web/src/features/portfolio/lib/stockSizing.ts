import { stockSizing, type SizingLevel, type StockSizing } from '../../../../../src/lib/positionSizing'
import { SATELLITE_MAX_WEIGHT_PCT } from '../../../lib/satelliteGuard'
import { isExchangeTradedProduct } from '../../../lib/tradeCost'
import { holdingAccountKey, holdingValue, isVirtualPositionRow } from './accountKey'
import type { HoldingRow } from '../types'

/** 실계좌(계좌 이름이 있는 보유)인가 — 봇 가상 계좌는 담을 크기 안내 대상이 아니다 */
export function isRealRow(r: HoldingRow): boolean {
  return !isVirtualPositionRow(r) && holdingAccountKey(r) !== '|||'
}

/** 개별주 한도(satelliteGuard)와 같은 분모: 실계좌 보유 평가액 합 */
export function realHoldingTotal(rows: HoldingRow[]): number {
  return rows.reduce((s, r) => (isRealRow(r) && Number(r.quantity || 0) > 0 ? s + holdingValue(r) : s), 0)
}

/** 실계좌 합계 + 종목별 합계(여러 계좌에 나눠 담은 같은 종목을 한 종목으로 본다) */
export type RealHoldingTotals = {
  total: number
  byCode: Record<string, { value: number; accounts: number }>
}

export function realHoldingTotals(rows: HoldingRow[]): RealHoldingTotals {
  const byCode: RealHoldingTotals['byCode'] = {}
  let total = 0
  for (const r of rows) {
    if (!isRealRow(r) || !(Number(r.quantity || 0) > 0)) continue
    const value = holdingValue(r)
    total += value
    const code = String(r.code || '').trim()
    const cur = byCode[code] ?? { value: 0, accounts: 0 }
    byCode[code] = { value: cur.value + value, accounts: cur.accounts + 1 }
  }
  return { total, byCode }
}

/**
 * 실계좌 개별주의 담을 크기. ETF·가상 계좌·변동성 자료가 없는 종목은 null.
 * 같은 종목을 여러 계좌에 나눠 담았으면 그 합계로 본다 — 계좌마다 따로 보면 각각은 한도 안이라 합계 초과를 놓쳤다.
 * addValue: 추가매수 창에서 입력한 매수 금액(보유 카드에서는 0).
 */
export function holdingSizing(r: HoldingRow, totals: RealHoldingTotals, addValue = 0): (StockSizing & { accounts: number }) | null {
  if (!isRealRow(r) || isExchangeTradedProduct(r.code, r.stock_name, r.stock_product_type)) return null
  const combined = totals.byCode[String(r.code || '').trim()]
  const current = combined ? combined.value : holdingValue(r)
  const sizing = stockSizing({
    totalValue: totals.total + Math.max(0, addValue),
    satelliteMaxPct: SATELLITE_MAX_WEIGHT_PCT,
    volRatio: r.sizing_vol_ratio,
    positionValue: current + Math.max(0, addValue),
  })
  return sizing ? { ...sizing, accounts: combined?.accounts ?? 1 } : null
}

export const SIZING_LEVEL_LABEL: Record<SizingLevel, string> = {
  small: '작은 편',
  normal: '보통',
  large: '큰 편',
}
