import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/userState', () => ({ userScopedKey: (k: string) => k }))

import { useLocalStorageBool } from './useLocalStorageBool'
import { useRecentSearches } from './useRecentSearches'

describe('useLocalStorageBool', () => {
  beforeEach(() => localStorage.clear())

  it('저장값이 없으면 기본값, 있으면 저장값', () => {
    expect(renderHook(() => useLocalStorageBool('chart.showHud', true)).result.current[0]).toBe(true)
    localStorage.setItem('chart.showMaEma', 'true')
    expect(renderHook(() => useLocalStorageBool('chart.showMaEma', false)).result.current[0]).toBe(true)
    localStorage.setItem('chart.showForce', 'false')
    expect(renderHook(() => useLocalStorageBool('chart.showForce', true)).result.current[0]).toBe(false)
  })
  it('바꾸면 저장되고 함수형 갱신도 된다', () => {
    const { result } = renderHook(() => useLocalStorageBool('chart.showHud', true))
    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
    expect(localStorage.getItem('chart.showHud')).toBe('false')
    act(() => result.current[1]((v) => !v))
    expect(result.current[0]).toBe(true)
    expect(localStorage.getItem('chart.showHud')).toBe('true')
  })
})

describe('useRecentSearches', () => {
  beforeEach(() => localStorage.clear())

  it('저장된 목록을 불러오고, 새 종목을 맨 앞에 두며 중복은 옮긴다', () => {
    localStorage.setItem('analyze.recentSearches', JSON.stringify([{ code: 'A', name: 'a' }, { code: 'B', name: 'b' }]))
    const { result } = renderHook(() => useRecentSearches())
    expect(result.current[0].map((s) => s.code)).toEqual(['A', 'B'])
    act(() => result.current[1]({ code: 'B', name: 'b' }))
    expect(result.current[0].map((s) => s.code)).toEqual(['B', 'A'])
    act(() => result.current[1]({ code: 'C', name: 'c' }))
    expect(result.current[0].map((s) => s.code)).toEqual(['C', 'B', 'A'])
    expect(JSON.parse(localStorage.getItem('analyze.recentSearches')!).map((s: any) => s.code)).toEqual(['C', 'B', 'A'])
  })
  it('최대 5개까지만 남긴다', () => {
    const { result } = renderHook(() => useRecentSearches())
    for (const c of ['1', '2', '3', '4', '5', '6']) act(() => result.current[1]({ code: c, name: c }))
    expect(result.current[0].map((s) => s.code)).toEqual(['6', '5', '4', '3', '2'])
  })
  it('저장값이 깨져 있으면 빈 목록', () => {
    localStorage.setItem('analyze.recentSearches', '{not json')
    expect(renderHook(() => useRecentSearches()).result.current[0]).toEqual([])
  })
})
