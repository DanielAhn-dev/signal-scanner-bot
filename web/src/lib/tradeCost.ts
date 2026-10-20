import { readUserState } from './userState'

// 매도 비용 추정 — 국내 ETF·ETN은 증권거래세가 없어 수수료만 뗀다. 판별은 서버와 같은 함수(사본을 두면 갈라진다:
// 예전 웹 사본은 알려진 ETF 코드에 TIGER 200·KODEX 레버리지가 없었다)
import { isExchangeTradedProduct } from '../../../src/lib/securitiesTax'
export { isExchangeTradedProduct }

/** 매도 요율(%) — ETF·ETN이면 매수수수료와 같은 수수료만 (기본 매도 요율 = 수수료 + 거래세) */
export function resolveSellCostPct(input: {
  code?: string | null
  name?: string | null
  /** 서버 stocks.product_type (positions 응답 stock_product_type) — 있으면 이름보다 먼저 */
  productType?: string | null
  sellRatePct: number
  feeRatePct: number
}): number {
  return isExchangeTradedProduct(input.code, input.name, input.productType) ? input.feeRatePct : input.sellRatePct
}

// 포트폴리오·대시보드가 같은 매매비용 설정(사용자별 저장, lib/userState.ts)을 읽도록 한 곳에 둔다

export interface TradeCostSettings { includeCost: boolean; buyFeeRatePct: number; sellFeeRatePct: number }

export function loadTradeCostSettings(): TradeCostSettings {
  const stored = readUserState<Partial<TradeCostSettings>>('tradeCost')
  return {
    includeCost: stored?.includeCost ?? true,
    buyFeeRatePct: stored?.buyFeeRatePct ?? 0.015,
    // 0.195 = 예전 기본값(거래세 0.18%) — 2026년 거래세 0.20%로 올려 읽는다
    sellFeeRatePct: stored?.sellFeeRatePct == null || stored.sellFeeRatePct === 0.195 ? 0.215 : stored.sellFeeRatePct,
  }
}
