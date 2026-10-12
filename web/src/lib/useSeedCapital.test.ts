import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSeedCapitalState } from './useSeedCapital'

let chatId = '123'
let response: Promise<unknown> = Promise.resolve({ data: { virtual_seed_capital: 2_000_000 } })
vi.mock('./api', () => ({ apiFetch: vi.fn(() => response) }))
vi.mock('../stores/profileStore', () => ({ useCurrentChatId: () => chatId }))

describe('useSeedCapitalState', () => {
  it('조회 중에는 loaded=false, 끝나면 값과 함께 loaded=true', async () => {
    chatId = '123'
    response = Promise.resolve({ data: { virtual_seed_capital: 2_000_000 } })
    const { result } = renderHook(() => useSeedCapitalState())
    expect(result.current).toEqual({ seed: null, loaded: false })
    await waitFor(() => expect(result.current).toEqual({ seed: 2_000_000, loaded: true }))
  })

  it('조회가 실패하거나 설정이 없어도 loaded=true (자동 동작이 영원히 멈추지 않게)', async () => {
    chatId = '123'
    response = Promise.reject(new Error('down'))
    const { result } = renderHook(() => useSeedCapitalState())
    await waitFor(() => expect(result.current).toEqual({ seed: null, loaded: true }))
  })

  it('계정이 없으면 조회하지 않고 바로 loaded=true', () => {
    chatId = ''
    const { result } = renderHook(() => useSeedCapitalState())
    expect(result.current).toEqual({ seed: null, loaded: true })
  })
})
