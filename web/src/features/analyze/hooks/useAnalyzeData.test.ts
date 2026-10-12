import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAnalyzeData } from './useAnalyzeData'

const pending = new Map<string, (v: unknown) => void>()
vi.mock('../../../lib/api', () => ({
  apiFetch: vi.fn((url: string) => {
    const code = /code=([^&]+)/.exec(url)?.[1] ?? ''
    return new Promise((resolve) => { pending.set(code, resolve) })
  }),
}))

describe('useAnalyzeData', () => {
  it('연달아 조회하면 늦게 도착한 먼저 보낸 조회가 마지막 결과를 덮어쓰지 않는다', async () => {
    const { result } = renderHook(() => useAnalyzeData({ chatId: '', query: '', setQuery: () => {}, pushRecentSearch: () => {} }))
    act(() => { void result.current.analyze('AAA') })
    act(() => { void result.current.analyze('BBB') })
    await act(async () => { pending.get('BBB')!({ profile: { code: 'BBB', name: '나중' }, latest: {} }) })
    expect(result.current.result?.code).toBe('BBB')
    expect(result.current.loading).toBe(false)
    await act(async () => { pending.get('AAA')!({ profile: { code: 'AAA', name: '먼저' }, latest: {} }) })
    expect(result.current.result?.code).toBe('BBB')
  })
})
