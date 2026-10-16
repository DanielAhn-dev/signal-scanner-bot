import { describe, expect, it } from 'vitest'
import { SIZING_REFERENCE_VOL_RATIO } from '../../../../../src/lib/positionSizing'
import { holdingSizing, realHoldingTotal } from './stockSizing'
import type { HoldingRow } from '../types'

const real = (patch: Partial<HoldingRow>): HoldingRow => ({
  code: '006400', stock_name: '삼성SDI', broker_name: '키움', account_name: '일반',
  quantity: 10, avg_price: 100_000, stock: { close: 100_000 }, sizing_vol_ratio: SIZING_REFERENCE_VOL_RATIO, ...patch,
})

describe('realHoldingTotal', () => {
  it('실계좌만 더한다(봇 가상 계좌 제외)', () => {
    const rows = [
      real({}),
      real({ code: '069500', stock_name: 'KODEX 200', quantity: 100, stock: { close: 40_000 } }),
      real({ broker_name: null, account_name: null, quantity: 999 }),
      real({ account_kind: 'virtual', quantity: 999 }),
    ]
    expect(realHoldingTotal(rows)).toBe(1_000_000 + 4_000_000)
  })
})

describe('holdingSizing', () => {
  it('보통 흔들림이면 총액×10%÷5, 추가 금액은 총액과 보유에 함께 더한다', () => {
    const s = holdingSizing(real({}), 49_000_000, 1_000_000)!
    expect(s.maxAmount).toBe(1_000_000)
    expect(s.overAmount).toBe(1_000_000)
  })
  it('ETF·가상 계좌·자료 없음은 null', () => {
    expect(holdingSizing(real({ code: '069500', stock_name: 'KODEX 200' }), 1e7)).toBeNull()
    expect(holdingSizing(real({ broker_name: null, account_name: null }), 1e7)).toBeNull()
    expect(holdingSizing(real({ sizing_vol_ratio: null }), 1e7)).toBeNull()
  })
})
