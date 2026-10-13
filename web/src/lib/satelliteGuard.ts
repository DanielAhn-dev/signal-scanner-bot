/**
 * 위성 몫(개별주 묶음) 경고 — 실계좌 보유 중 ETF가 아닌 종목을 한 묶음으로 본다.
 *
 * holdingAdvice는 종목 하나씩(비중·손실) 보고, 이건 개별주 전체가 얼마나 커졌는지·얼마나 잃고 있는지만 본다.
 * 근거: 종목 선별·단기매매로 지수를 이기는 우위를 못 찾았다(가설 장부 C1, C15~C27). 그래서 개별주는
 * "작게, 잃는 한도를 정해 두고"가 원칙이다. 매매를 막지 않는 경고다. 봇 가상계좌는 같은 값(상한 10%·분기 손실 −15%)으로
 * 실제 매수를 막는다(src/services/virtualAutoTradeQuarterLossGuard.ts, 2026-10-13 조기 반영).
 *
 * 한계: 비중의 분모는 이 앱에 입력한 실계좌 보유 평가액뿐이다(예금·현금·입력 안 한 계좌는 빠짐).
 * 손실은 지금 들고 있는 개별주의 평가손익만 본다 — 이미 팔아 확정한 손실은 들어가지 않는다.
 */
import { REBALANCE_BAND_PP } from '../../../src/lib/incomeGuide'
import { isExchangeTradedProduct } from './tradeCost'

export const SATELLITE_MAX_WEIGHT_PCT = 10
/**
 * 개별주를 실제로 팔아 줄이라고 안내하는 선 = 목표 10% + 리밸런싱 밴드 10%p = 20%.
 * 그 아래(10~20%)는 팔지 않고 새 돈을 지수로 넣어 자연스럽게 비중을 낮춘다 — 적립 우선 + 10%p 넘을 때만 매도(C14, H14).
 */
export const SATELLITE_SELL_WEIGHT_PCT = SATELLITE_MAX_WEIGHT_PCT + REBALANCE_BAND_PP
export const SATELLITE_LOSS_LIMIT_PCT = -15

export type SatelliteHolding = { code: string; name: string; quantity: number; avgPrice: number; currentPrice: number }

export type SatelliteStatus = {
  weightPct: number
  pnlPct: number
  stockValue: number
  totalValue: number
  stockCount: number
  /** 목표(10%) 초과 — 추가매수 멈추고 새 돈은 지수로 */
  overWeight: boolean
  /** 매도 선(20%) 초과 — 목표까지 일부 정리 */
  overSellBand: boolean
  overLoss: boolean
  /** overSellBand일 때 목표(10%)로 되돌리는 데 줄일 금액, 아니면 0 */
  trimAmount: number
}

export function satelliteStatus(holdings: SatelliteHolding[]): SatelliteStatus | null {
  let totalValue = 0
  let stockValue = 0
  let stockCost = 0
  let stockCount = 0
  for (const h of holdings) {
    const price = h.currentPrice > 0 ? h.currentPrice : h.avgPrice
    const value = h.quantity * price
    if (!(value > 0)) continue
    totalValue += value
    if (isExchangeTradedProduct(h.code, h.name)) continue
    stockValue += value
    stockCost += h.quantity * h.avgPrice
    stockCount++
  }
  if (!(totalValue > 0) || stockCount === 0) return null
  const weightPct = (stockValue / totalValue) * 100
  const pnlPct = stockCost > 0 ? (stockValue / stockCost - 1) * 100 : 0
  // 매도 선을 넘었을 때 목표 비중까지 낮추려면 줄일 금액: (s - x) / (T - x) = m  →  x = (s - mT) / (1 - m)
  const m = SATELLITE_MAX_WEIGHT_PCT / 100
  const overSellBand = weightPct > SATELLITE_SELL_WEIGHT_PCT
  const trimAmount = overSellBand ? Math.max(0, Math.round((stockValue - m * totalValue) / (1 - m))) : 0
  return {
    weightPct,
    pnlPct,
    stockValue,
    totalValue,
    stockCount,
    overWeight: weightPct > SATELLITE_MAX_WEIGHT_PCT,
    overSellBand,
    overLoss: pnlPct <= SATELLITE_LOSS_LIMIT_PCT,
    trimAmount,
  }
}
