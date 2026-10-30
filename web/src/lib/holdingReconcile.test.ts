import { describe, expect, it } from 'vitest'
import { reconcileHolding } from './holdingReconcile'

const cur = { quantity: 120, investedAmount: 120 * 35210, avgPrice: 35210 }

describe('reconcileHolding', () => {
  it('비워 두면 건너뛴다', () => {
    expect(reconcileHolding(cur, null, null).kind).toBe('empty')
    expect(reconcileHolding(cur, NaN, undefined).kind).toBe('empty')
  })

  it('하나만 적으면 오류', () => {
    expect(reconcileHolding(cur, 123, null).kind).toBe('invalid')
    expect(reconcileHolding(cur, null, 35300).kind).toBe('invalid')
  })

  it('수량이 늘면 추가분 단가를 역산한다', () => {
    const r = reconcileHolding(cur, 123, 35300)
    expect(r.kind).toBe('buy')
    if (r.kind !== 'buy') return
    expect(r.addQty).toBe(3)
    // 123*35300 − 120*35210 = 4,341,900 − 4,225,200 = 116,700 → 38,900
    expect(r.addAmount).toBe(116700)
    expect(r.unitPrice).toBeCloseTo(38900, 6)
    expect(r.gapPerShare).toBeCloseTo(38900 - 35210, 6)
  })

  it('역산한 단가로 매수하면 평단이 입력한 평단과 맞는다', () => {
    const r = reconcileHolding(cur, 125, 35333)
    if (r.kind !== 'buy') throw new Error('buy 아님')
    const invested = cur.investedAmount + r.addQty * r.unitPrice
    expect(invested / 125).toBeCloseTo(35333, 6)
  })

  it('투입금액이 없으면 수량 × 평단으로 대신한다', () => {
    const r = reconcileHolding({ quantity: 10, avgPrice: 1000 }, 12, 1100)
    if (r.kind !== 'buy') throw new Error('buy 아님')
    expect(r.unitPrice).toBeCloseTo((12 * 1100 - 10000) / 2, 6)
  })

  it('수량이 줄면 매도 안내', () => {
    expect(reconcileHolding(cur, 100, 35210)).toEqual({ kind: 'sell', lessQty: 20 })
  })

  it('수량이 같으면 변화 없음, 평단만 다르면 기록하지 않음', () => {
    expect(reconcileHolding(cur, 120, 35210).kind).toBe('same')
    expect(reconcileHolding(cur, 120, 35260).kind).toBe('avgOnly')
  })

  it('평단이 내려가 추가 매수로 설명되지 않으면 오류', () => {
    expect(reconcileHolding(cur, 121, 30000).kind).toBe('invalid')
  })

  it('수량 정수·평단 양수 검사', () => {
    expect(reconcileHolding(cur, 1.5, 100).kind).toBe('invalid')
    expect(reconcileHolding(cur, 130, 0).kind).toBe('invalid')
  })

  it('최근 종가에서 ±30% 넘으면 경고', () => {
    const r = reconcileHolding(cur, 123, 35300, 20000)
    if (r.kind !== 'buy') throw new Error('buy 아님')
    expect(r.warnings.join()).toContain('±30%')
  })

  it('추가 수량이 적으면 반올림 오차 경고', () => {
    const r = reconcileHolding({ quantity: 1000, investedAmount: 1000 * 10000, avgPrice: 10000 }, 1001, 10001)
    if (r.kind !== 'buy') throw new Error('buy 아님')
    expect(r.warnings.length).toBe(1)
  })
})
