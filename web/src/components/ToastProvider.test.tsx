import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ToastProvider, useToast } from './ToastProvider'

describe('ToastProvider', () => {
  it('토스트가 뜨고 사라져도 useToast 값은 같은 객체다 (의존하는 조회 효과가 다시 돌지 않게)', () => {
    const seen: unknown[] = []
    let api: ReturnType<typeof useToast> | null = null
    function Probe() {
      api = useToast()
      seen.push(api)
      return null
    }
    render(<ToastProvider><Probe /></ToastProvider>)
    act(() => { api!.show('하나', 10) })
    expect(document.body.textContent).toContain('하나')
    expect(new Set(seen).size).toBe(1)
  })

  it('새 토스트는 앞 토스트의 타이머에 일찍 지워지지 않는다', async () => {
    let api: ReturnType<typeof useToast> | null = null
    function Probe() { api = useToast(); return null }
    render(<ToastProvider><Probe /></ToastProvider>)
    act(() => { api!.show('첫째', 30) })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    act(() => { api!.show('둘째', 200) })
    await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
    expect(document.body.textContent).toContain('둘째')
  })
})
