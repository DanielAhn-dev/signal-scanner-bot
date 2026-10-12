import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useHoldingCount } from './useHoldingCount'

let calls = 0
vi.mock('../../../lib/api', () => ({
  apiFetch: vi.fn(() => {
    calls += 1
    return Promise.reject(new Error('positions down'))
  }),
}))
vi.mock('../../../lib/userState', () => ({ useSyncedSettings: () => {} }))

describe('useHoldingCount', () => {
  it('매수검토 필터에서 보유 수 조회가 실패해도 재조회를 반복하지 않는다', async () => {
    const { result } = renderHook(() => useHoldingCount({ conditionFilter: 'buycheck' }))
    await waitFor(() => expect(result.current.holdingCountLoading).toBe(false))
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toBe(1)
    expect(result.current.holdingCount).toBeNull()
  })
})
