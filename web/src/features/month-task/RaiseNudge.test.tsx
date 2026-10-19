import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RaiseNudge, { raiseDue } from './RaiseNudge'
import { userScopedKey } from '../../lib/userState'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({
  useCurrentClientId: () => 'test-user',
  useCurrentChatId: () => '1',
  getCurrentClientIdFromStore: () => 'test-user',
  getCurrentChatIdFromStore: () => '1',
}))

describe('해마다 늘리기 알림 시점', () => {
  it('1월에만, 작년 이전에 정했고 올해 아직 답하지 않았을 때', () => {
    const r = { pct: 0.05, since: '2026-10' }
    expect(raiseDue(r, '2027-01-03')).toBe(true)
    expect(raiseDue(r, '2027-02-01')).toBe(false)
    expect(raiseDue({ ...r, since: '2027-01' }, '2027-01-03')).toBe(false)
    expect(raiseDue({ ...r, appliedYear: 2027 }, '2027-01-20')).toBe(false)
    expect(raiseDue(undefined, '2027-01-03')).toBe(false)
  })
})

describe('홈 해마다 늘리기 알림', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-01-05T03:00:00Z'))
    localStorage.clear()
    localStorage.setItem(userScopedKey('state:accumulate')!, JSON.stringify({ value: { raise: { pct: 0.05, since: '2026-10' } }, updatedAt: Date.now() }))
    apiFetchMock.mockReset()
    apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.startsWith('/api/ui/investment-prefs') && opts?.method === 'POST') return Promise.resolve({ ok: true })
      if (url.startsWith('/api/ui/investment-prefs')) return Promise.resolve({ data: { plan: { monthly: 1_220_000 } } })
      return Promise.reject(new Error(`unmocked ${url}`))
    })
  })
  afterEach(() => { vi.useRealTimers() })

  it('새 금액으로 바꾸면 내 계획을 저장하고, 계획 변경을 알리고, 올해는 다시 묻지 않는다', async () => {
    const changed = vi.fn()
    window.addEventListener('nexora:plan-changed', changed)
    const { container } = render(<RaiseNudge />)
    expect(await screen.findByText(/올해는 넣는 돈을 5% 늘리기로 했어요/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '128만원으로 바꾸기' }))
    await waitFor(() => expect(container.textContent).toBe(''))
    const post = apiFetchMock.mock.calls.find(([, o]) => o?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ plan: { monthly: 1_280_000 } })
    expect(changed).toHaveBeenCalled()
    window.removeEventListener('nexora:plan-changed', changed)
  })

  it('"올해는 그대로"는 저장 없이 답만 남긴다', async () => {
    const { container } = render(<RaiseNudge />)
    fireEvent.click(await screen.findByRole('button', { name: '올해는 그대로' }))
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(apiFetchMock.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false)
  })
})
