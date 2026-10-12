import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAutoRuns } from './useAutoRuns'

const posts: unknown[] = []
let release: (() => void) | null = null
vi.mock('../../../lib/api', () => ({
  apiFetch: vi.fn((_url: string, opts?: { body?: string }) => {
    posts.push(opts?.body ? JSON.parse(opts.body) : null)
    return new Promise((resolve) => { release = () => resolve({ job_id: 'j1' }) })
  }),
}))

describe('useAutoRuns', () => {
  it('실행 요청이 진행 중이면 연타해도 한 번만 보낸다 (disabled 반영 전 더블탭)', async () => {
    const shown: string[] = []
    const { result } = renderHook(() => useAutoRuns({
      toast: { show: (m) => { shown.push(m) } },
      addWatchingJob: () => {},
      refreshJobSnapshot: async () => {},
      setPendingDryRunApproval: () => {},
      setBannerDismissedForJobId: () => {},
    }))
    let first: Promise<void> | undefined
    act(() => {
      first = result.current.runAutocycle(false)
      void result.current.runAutocycle(false)
    })
    expect(posts).toHaveLength(1)
    await act(async () => { release?.(); await first })
    expect(shown).toEqual(['자동사이클 실행 등록 완료'])
    // 끝난 뒤에는 다시 보낼 수 있다
    act(() => { void result.current.runAutocycle(true) })
    expect(posts).toHaveLength(2)
    await act(async () => { release?.() })
  })
})
