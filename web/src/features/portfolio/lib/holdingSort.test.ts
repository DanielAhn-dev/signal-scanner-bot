import { describe, expect, it } from 'vitest'
import { sortHoldings } from './holdingSort'
import type { HoldingRow } from '../types'

const row = (code: string, pct: number | null, qty: number, close: number): HoldingRow => ({
  code, quantity: qty, avg_price: 10_000, stock: { close },
  unrealized_pct: pct, unrealized_pnl: pct == null ? null : qty * 10_000 * pct / 100,
})
const opts = { includeCost: false, tradeCostOpts: { buyFeeRatePct: 0, sellFeeRatePct: 0 } }
const codes = (rows: HoldingRow[]) => rows.map((r) => r.code)

const rows = [
  row('A', 4.7, 3, 10_470),
  row('B', -18.2, 185, 8_180),
  row('C', null, 1, 10_000),
  row('D', -1.1, 35, 9_890),
]

describe('sortHoldings', () => {
  it('기본 순은 원래 순서 그대로', () => {
    expect(codes(sortHoldings(rows, 'default', opts))).toEqual(['A', 'B', 'C', 'D'])
  })
  it('수익률 높은 순·낮은 순, 값 없는 종목은 둘 다 맨 뒤', () => {
    expect(codes(sortHoldings(rows, 'pct_desc', opts))).toEqual(['A', 'D', 'B', 'C'])
    expect(codes(sortHoldings(rows, 'pct_asc', opts))).toEqual(['B', 'D', 'A', 'C'])
  })
  it('평가금액 많은 순(수량 × 현재가)', () => {
    expect(codes(sortHoldings(rows, 'value_desc', opts))).toEqual(['B', 'D', 'A', 'C'])
  })
  it('원본 배열을 바꾸지 않는다', () => {
    sortHoldings(rows, 'pct_asc', opts)
    expect(codes(rows)).toEqual(['A', 'B', 'C', 'D'])
  })
})
