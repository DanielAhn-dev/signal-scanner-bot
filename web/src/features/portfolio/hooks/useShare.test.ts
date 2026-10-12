import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useShare } from './useShare'

const posts: unknown[] = []
vi.mock('../../../lib/api', () => ({
  apiFetch: vi.fn((_url: string, opts?: { method?: string }) => {
    if (opts?.method === 'POST') {
      posts.push(1)
      return new Promise((_, reject) => setTimeout(() => reject(new Error('share down')), 10))
    }
    return new Promise((resolve) => setTimeout(() => resolve({ data: [] }), 10))
  }),
  invalidateCache: vi.fn(),
}))
const toastApi = { show: () => {} }
vi.mock('../../../components/ToastProvider', () => ({ useToast: () => toastApi }))

describe('useShare', () => {
  it('모달을 열 때 자동 생성이 실패해도 생성 요청을 반복하지 않는다', async () => {
    const { result } = renderHook(() => useShare())
    act(() => { result.current.setShareModalOpen(true) })
    await waitFor(() => expect(posts.length).toBeGreaterThanOrEqual(1))
    await waitFor(() => expect(result.current.shareCreating).toBe(false))
    await new Promise((r) => setTimeout(r, 200))
    expect(posts).toHaveLength(1)
  })
})
