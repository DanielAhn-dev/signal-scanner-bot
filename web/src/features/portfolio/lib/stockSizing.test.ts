import { describe, expect, it } from 'vitest'
import { SIZING_REFERENCE_VOL_RATIO } from '../../../../../src/lib/positionSizing'
import { holdingSizing, realHoldingTotal, realHoldingTotals } from './stockSizing'
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
    const s = holdingSizing(real({}), { total: 49_000_000, byCode: {} }, 1_000_000)!
    expect(s.maxAmount).toBe(1_000_000)
    expect(s.overAmount).toBe(1_000_000)
  })
  it('ETF·가상 계좌·자료 없음은 null', () => {
    const t = { total: 1e7, byCode: {} }
    expect(holdingSizing(real({ code: '069500', stock_name: 'KODEX 200' }), t)).toBeNull()
    expect(holdingSizing(real({ broker_name: null, account_name: null }), t)).toBeNull()
    expect(holdingSizing(real({ sizing_vol_ratio: null }), t)).toBeNull()
  })
  it('같은 종목을 여러 계좌에 나눠 담으면 합계로 판정한다', () => {
    // 총 5,000만 → 보통 흔들림 최대 100만. 계좌마다 80만씩이면 각각은 한도 안이지만 합계 160만은 60만 초과
    const rows = [
      real({ quantity: 8 }),
      real({ broker_name: '토스', quantity: 8 }),
      real({ code: '069500', stock_name: 'KODEX 200', quantity: 1210, stock: { close: 40_000 } }),
    ]
    const totals = realHoldingTotals(rows)
    expect(totals.total).toBe(50_000_000)
    expect(totals.byCode['006400']).toEqual({ value: 1_600_000, accounts: 2 })
    const s = holdingSizing(rows[0], totals)!
    expect(s.accounts).toBe(2)
    expect(s.overAmount).toBe(600_000)
  })
})
