import { resolveSellCostPct } from '../../../lib/tradeCost'
import type { HoldingRow } from '../types'

export type SummaryOptions = {
  includeCost: boolean
  buyFeeRatePct: number
  sellFeeRatePct: number
  initialCapital: number
  /** DB에 기록된 실제 현금(virtual_cash). 있으면 추정(시드 − 매수 원금) 대신 쓴다 — 추정은 실현 손익·분배금을 빼먹는다 */
  cashOverride?: number | null
}

export type TradeCostOptions = Pick<SummaryOptions, 'buyFeeRatePct' | 'sellFeeRatePct'>

/** 한 종목의 매수비용(이미 발생) + 매도예상비용(현재가 기준) */
export function rowTradeCost(r: HoldingRow, opts: TradeCostOptions): number {
  const invested = Number(r.quantity || 0) * Number(r.avg_price || 0)
  const currentValue = invested + Number(r.unrealized_pnl || 0)
  const buyCost = invested * (opts.buyFeeRatePct / 100)
  const sellPct = resolveSellCostPct({ code: r.code ?? r.ticker, name: r.stock_name, sellRatePct: opts.sellFeeRatePct, feeRatePct: opts.buyFeeRatePct })
  const sellCost = currentValue > 0 ? currentValue * (sellPct / 100) : 0
  return buyCost + sellCost
}

/** 보유 행 합계: 투자금·평가손익(비용 차감 선택)·수익률·추정 현금·총자산 */
export function summarizeHoldings(rows: HoldingRow[], opts: SummaryOptions) {
  const totalUnrealized = rows.reduce((acc: number, r: HoldingRow) => acc + Number(r.unrealized_pnl || 0), 0)
  const totalInvested = rows.reduce((acc: number, r: HoldingRow) => acc + (Number(r.quantity || 0) * Number(r.avg_price || 0)), 0)
  // 비용 계산: 매수비용(이미 발생) + 매도예상비용(현재가 기준)
  const totalTradeCost = rows.reduce((acc: number, r: HoldingRow) => acc + rowTradeCost(r, opts), 0)
  const adjustedUnrealized = opts.includeCost ? totalUnrealized - totalTradeCost : totalUnrealized
  const totalReturnPct = totalInvested > 0 ? (adjustedUnrealized / totalInvested) * 100 : 0
  const totalEvaluationValue = totalInvested + adjustedUnrealized
  const estimatedCash = opts.cashOverride != null && Number.isFinite(opts.cashOverride) ? opts.cashOverride : opts.initialCapital - totalInvested
  const totalAssetValue = totalEvaluationValue + estimatedCash
  return {
    totalUnrealized,
    totalInvested,
    totalTradeCost,
    adjustedUnrealized,
    totalReturnPct,
    totalEvaluationValue,
    estimatedCash,
    totalAssetValue,
  }
}
