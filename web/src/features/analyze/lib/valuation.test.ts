import { describe, expect, it } from 'vitest'
import { hasNoValuationData } from './valuation'

describe('hasNoValuationData', () => {
  it('네 값이 모두 비면 true', () => {
    expect(hasNoValuationData({ per: null, pbr: null, roe: undefined, debt_ratio: null })).toBe(true)
    expect(hasNoValuationData({})).toBe(true)
  })

  it('하나라도 숫자가 있으면 false(0 포함)', () => {
    expect(hasNoValuationData({ per: 6.7 })).toBe(false)
    expect(hasNoValuationData({ debt_ratio: 0 })).toBe(false)
  })

  it('결과가 없으면 안내하지 않는다', () => {
    expect(hasNoValuationData(null)).toBe(false)
  })
})
