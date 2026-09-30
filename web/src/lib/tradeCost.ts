// 매도 비용 추정 — 국내 ETF·ETN은 증권거래세가 없어 수수료만 뗀다 (src/lib/securitiesTax.ts와 같은 판별)
const ETF_BRAND_PATTERN =
  /^(KODEX|TIGER|KBSTAR|RISE|ACE|SOL|HANARO|KOSEF|ARIRANG|PLUS|KIWOOM|TIMEFOLIO|WOORI|BNK|UNICORN|FOCUS|TREX|VITA|마이다스|에셋플러스|히어로즈|파워|마이티|KTOP|1Q|DAISHIN343|WON)\b/i
const KNOWN_ETF_CODES = new Set(['459580', '069500', '229200', '423160', '357870'])

export function isExchangeTradedProduct(code?: string | null, name?: string | null): boolean {
  if (code && KNOWN_ETF_CODES.has(String(code).trim())) return true
  const n = String(name ?? '').trim()
  return !!n && (ETF_BRAND_PATTERN.test(n) || /\bETN\b/i.test(n))
}

/** 매도 요율(%) — ETF·ETN이면 매수수수료와 같은 수수료만 (기본 매도 요율 = 수수료 + 거래세) */
export function resolveSellCostPct(input: { code?: string | null; name?: string | null; sellRatePct: number; feeRatePct: number }): number {
  return isExchangeTradedProduct(input.code, input.name) ? input.feeRatePct : input.sellRatePct
}

// 포트폴리오·대시보드가 같은 매매비용 설정(브라우저 저장)을 읽도록 한 곳에 둔다
export const TRADE_COST_STORAGE_KEY = 'portfolio.tradeCost.v1'

export interface TradeCostSettings { includeCost: boolean; buyFeeRatePct: number; sellFeeRatePct: number }

export function loadTradeCostSettings(): TradeCostSettings {
  let stored: Partial<TradeCostSettings> | null = null
  try {
    stored = JSON.parse(window.localStorage.getItem(TRADE_COST_STORAGE_KEY) || 'null')
  } catch {
    stored = null
  }
  return {
    includeCost: stored?.includeCost ?? true,
    buyFeeRatePct: stored?.buyFeeRatePct ?? 0.015,
    // 0.195 = 예전 기본값(거래세 0.18%) — 2026년 거래세 0.20%로 올려 읽는다
    sellFeeRatePct: stored?.sellFeeRatePct == null || stored.sellFeeRatePct === 0.195 ? 0.215 : stored.sellFeeRatePct,
  }
}
