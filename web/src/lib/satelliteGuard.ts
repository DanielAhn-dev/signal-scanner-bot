/**
 * 위성 몫(개별주 묶음) 경고 — 실계좌 보유 중 ETF가 아닌 종목을 한 묶음으로 본다.
 *
 * holdingAdvice는 종목 하나씩(비중·손실) 보고, 이건 개별주 전체가 얼마나 커졌는지·얼마나 잃고 있는지만 본다.
 * 근거: 종목 선별·단기매매로 지수를 이기는 우위를 못 찾았다(가설 장부 C1, C15~C27). 그래서 개별주는
 * "작게, 잃는 한도를 정해 두고"가 원칙이다. 매매를 막지 않는 경고이고, 봇 가상계좌 상한은 11/23 관문 안건이다.
 *
 * 한계: 비중의 분모는 이 앱에 입력한 실계좌 보유 평가액뿐이다(예금·현금·입력 안 한 계좌는 빠짐).
 * 손실은 지금 들고 있는 개별주의 평가손익만 본다 — 이미 팔아 확정한 손실은 들어가지 않는다.
 */
import { isExchangeTradedProduct } from './tradeCost'

export const SATELLITE_MAX_WEIGHT_PCT = 10
export const SATELLITE_LOSS_LIMIT_PCT = -15

export type SatelliteHolding = { code: string; name: string; quantity: number; avgPrice: number; currentPrice: number }

export type SatelliteStatus = {
  weightPct: number
  pnlPct: number
  stockValue: number
  totalValue: number
  stockCount: number
  overWeight: boolean
  overLoss: boolean
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
  // 비중을 상한까지 낮추려면 줄일 금액: (s - x) / (T - x) = m  →  x = (s - mT) / (1 - m)
  const m = SATELLITE_MAX_WEIGHT_PCT / 100
  const trimAmount = Math.max(0, Math.round((stockValue - m * totalValue) / (1 - m)))
  return {
    weightPct,
    pnlPct,
    stockValue,
    totalValue,
    stockCount,
    overWeight: weightPct > SATELLITE_MAX_WEIGHT_PCT,
    overLoss: pnlPct <= SATELLITE_LOSS_LIMIT_PCT,
    trimAmount,
  }
}
