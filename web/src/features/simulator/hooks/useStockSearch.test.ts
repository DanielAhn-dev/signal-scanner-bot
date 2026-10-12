import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useStockSearch } from './useStockSearch'

const pending = new Map<string, (v: unknown) => void>()
vi.mock('../../../lib/stockCache', () => ({
  searchStocks: vi.fn((q: string) => new Promise((resolve) => { pending.set(q, resolve) })),
}))

describe('useStockSearch', () => {
  it('입력이 바뀐 뒤 늦게 온 옛 검색 결과는 버린다', async () => {
    const { result } = renderHook(() => useStockSearch())
    act(() => { result.current.setAddSearch('삼성') })
    await waitFor(() => expect(pending.has('삼성')).toBe(true))
    act(() => { result.current.setAddSearch('삼성전자') })
    await waitFor(() => expect(pending.has('삼성전자')).toBe(true))
    await act(async () => { pending.get('삼성전자')!([{ code: '005930', name: '삼성전자' }]) })
    await act(async () => { pending.get('삼성')!([{ code: '000001', name: '옛 결과' }]) })
    expect(result.current.addResults).toEqual([{ code: '005930', name: '삼성전자' }])
  })
})
