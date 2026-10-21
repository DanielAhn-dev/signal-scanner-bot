/**
 * 보유 평가용 현재가 고르기 — 실시간가 → stocks.close 순, 둘 다 없으면 null(가격 없음).
 *
 * stocks.close가 0인 행이 있다(2026-10-21 활성 1,386행, 보유 ETF 포함). `Number(close)`를
 * 그대로 쓰면 0도 유효한 숫자라 평가액 0·수익률 −100%로 계산됐다. 0·음수·빈 값은 가격 없음으로 본다.
 */
export function positivePrice(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export type HoldingPriceSource = 'realtime' | 'close'

export function resolveHoldingPrice(
  realtimePrice: unknown,
  dbClose: unknown,
): { price: number | null; source: HoldingPriceSource | null } {
  const rt = positivePrice(realtimePrice)
  if (rt != null) return { price: rt, source: 'realtime' }
  const close = positivePrice(dbClose)
  if (close != null) return { price: close, source: 'close' }
  return { price: null, source: null }
}
