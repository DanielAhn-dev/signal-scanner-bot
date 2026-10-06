import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FamilyPage from './index'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

const renderPage = () => render(<MemoryRouter><FamilyPage /></MemoryRouter>)
const posts = () => apiFetchMock.mock.calls.filter(([, o]) => o?.method === 'POST').map(([, o]) => JSON.parse(o.body))

const active = {
  status: 'active', since: '2026-10-06T00:00:00Z',
  myShares: { spending: true, investing: true, children: true, plan: true },
  partnerShares: { spending: true, investing: true, children: false, plan: true },
  partner: {
    nickname: '지은',
    investing: { seed: 10_000_000, total: 11_500_000, cash: 1_500_000, holdings: 10_000_000, monthlyDeposit: 500_000, principal: 12_000_000 },
    check: { date: '2026-10-05', input: { monthlyIncome: 4_000_000, reserveMonthly: 0, fixed: [{ categoryId: 'rent', amount: 1_000_000 }], variable: [], irregular: [] } },
  },
}

beforeEach(() => {
  window.localStorage.clear()
  apiFetchMock.mockReset()
})

describe('부부 연결', () => {
  it('연결 전: 코드를 만들 수 있고, 받은 코드로 연결을 보낸다', async () => {
    apiFetchMock.mockImplementation((_p: string, o?: { method?: string }) => Promise.resolve(o?.method === 'POST' ? { ok: true } : { data: { status: 'none', ttlDays: 7 } }))
    renderPage()
    expect(await screen.findByText(/초대권 필요 없음/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('연결 코드'), { target: { value: 'abcde-fghjk' } })
    fireEvent.click(screen.getByRole('button', { name: '연결하기' }))
    await waitFor(() => expect(posts()).toEqual([{ action: 'accept', code: 'ABCDE-FGHJK' }]))
  })

  it('링크로 들어온 회원은 코드가 채워져 있고 연결 요청으로 보인다', async () => {
    window.localStorage.setItem('couple-code-stash', 'ABCDE-FGHJK')
    apiFetchMock.mockResolvedValue({ data: { status: 'none', ttlDays: 7 } })
    renderPage()
    expect(await screen.findByText('배우자가 보낸 연결 요청')).toBeTruthy()
    expect((screen.getByLabelText('연결 코드') as HTMLInputElement).value).toBe('ABCDE-FGHJK')
  })

  it('서버가 거절한 이유를 보여 준다', async () => {
    apiFetchMock.mockImplementation((_p: string, o?: { method?: string }) => Promise.resolve(o?.method === 'POST' ? { ok: false, error: '이미 다른 사람과 연결되어 있습니다.' } : { data: { status: 'none', ttlDays: 7 } }))
    renderPage()
    await screen.findByLabelText('연결 코드')
    fireEvent.change(screen.getByLabelText('연결 코드'), { target: { value: 'ABCDE-FGHJK' } })
    fireEvent.click(screen.getByRole('button', { name: '연결하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 다른 사람과 연결되어 있습니다.')
  })

  it('연결 후: 상대가 공유한 투자 요약만 보이고, 내 공유를 끌 수 있다', async () => {
    apiFetchMock.mockImplementation((_p: string, o?: { method?: string }) => Promise.resolve(o?.method === 'POST' ? { ok: true } : { data: active }))
    renderPage()
    expect(await screen.findByText('지은님과 연결됨')).toBeTruthy()
    expect(screen.getByLabelText('배우자 투자 요약')).toHaveTextContent('11,500,000원')
    expect(screen.getByLabelText('배우자 투자 요약')).toHaveTextContent('12,000,000원')
    // 자녀는 공유하지 않음
    expect(screen.getAllByText('공유하지 않았습니다.')).toHaveLength(1)
    // 배우자 점검 결과도 같은 계산으로 보인다
    expect(screen.getByLabelText('배우자 점검 결과')).toHaveTextContent('투자 가능액(월)3,000,000원')
    fireEvent.click(screen.getByRole('checkbox', { name: /^투자가상 계좌/ }))
    await waitFor(() => expect(posts()).toEqual([{ action: 'set-shares', shares: { investing: false } }]))
  })
})
