import { renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AMOUNT_MASK, useAmountMask, useAmountMaskStore } from './amountMaskStore'

afterEach(() => {
  useAmountMaskStore.setState({ hidden: false })
  localStorage.clear()
})

describe('useAmountMask', () => {
  it('보일 때는 원래 포맷, 가릴 때는 ••• 이고 손익 색 클래스를 뺀다', () => {
    const { result } = renderHook(() => useAmountMask())
    expect(result.current.krw(1234)).toBe('1,234원')
    expect(result.current.compact(12_550_000)).toBe('1,255만원')
    expect(result.current.tone('negative')).toBe('negative')

    act(() => useAmountMaskStore.getState().toggle())
    expect(result.current.hidden).toBe(true)
    expect(result.current.krw(1234)).toBe(AMOUNT_MASK)
    expect(result.current.compact(12_550_000, { showPositiveSign: true })).toBe(AMOUNT_MASK)
    expect(result.current.text('+3.2%')).toBe(AMOUNT_MASK)
    expect(result.current.tone('negative')).toBe('')
  })

  it('켠 상태를 기기에 기억한다', () => {
    act(() => useAmountMaskStore.getState().toggle())
    expect(localStorage.getItem('amount-mask:v1')).toBe('1')
    act(() => useAmountMaskStore.getState().toggle())
    expect(localStorage.getItem('amount-mask:v1')).toBe('0')
  })
})
