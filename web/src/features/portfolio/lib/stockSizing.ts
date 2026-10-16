import { stockSizing, type SizingLevel, type StockSizing } from '../../../../../src/lib/positionSizing'
import { SATELLITE_MAX_WEIGHT_PCT } from '../../../lib/satelliteGuard'
import { isExchangeTradedProduct } from '../../../lib/tradeCost'
import { holdingAccountKey, holdingValue, isVirtualPositionRow } from './accountKey'
import type { HoldingRow } from '../types'

/** 실계좌(계좌 이름이 있는 보유)인가 — 봇 가상 계좌는 담을 크기 안내 대상이 아니다 */
function isRealRow(r: HoldingRow): boolean {
  return !isVirtualPositionRow(r) && holdingAccountKey(r) !== '|||'
}

/** 개별주 한도(satelliteGuard)와 같은 분모: 실계좌 보유 평가액 합 */
export function realHoldingTotal(rows: HoldingRow[]): number {
  return rows.reduce((s, r) => (isRealRow(r) && Number(r.quantity || 0) > 0 ? s + holdingValue(r) : s), 0)
}

/**
 * 실계좌 개별주의 담을 크기. ETF·가상 계좌·변동성 자료가 없는 종목은 null.
 * addValue: 추가매수 창에서 입력한 매수 금액(보유 카드에서는 0).
 */
export function holdingSizing(r: HoldingRow, totalValue: number, addValue = 0): StockSizing | null {
  if (!isRealRow(r) || isExchangeTradedProduct(r.code, r.stock_name)) return null
  const current = holdingValue(r)
  return stockSizing({
    totalValue: totalValue + Math.max(0, addValue),
    satelliteMaxPct: SATELLITE_MAX_WEIGHT_PCT,
    volRatio: r.sizing_vol_ratio,
    positionValue: current + Math.max(0, addValue),
  })
}

export const SIZING_LEVEL_LABEL: Record<SizingLevel, string> = {
  small: '작은 편',
  normal: '보통',
  large: '큰 편',
}
