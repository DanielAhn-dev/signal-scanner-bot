import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MoneyFlowPage from './index'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({ useCurrentClientId: () => 'test-user', getCurrentClientIdFromStore: () => 'test-user' }))

let childValue: unknown = { children: [{ id: 'k1', alias: '첫째', birth: '2018-03', gifts: [] }] }
const setChild = vi.fn((next: unknown) => { childValue = next })
vi.mock('../../lib/userState', () => ({
  useUserState: (key: string) => (key === 'childGifts' ? { value: childValue, set: setChild, ready: true, saved: true } : { value: null, set: vi.fn(), ready: true, saved: false }),
}))

const input = {
  monthlyIncome: 4_000_000, reserveMonthly: 0,
  fixed: [{ categoryId: 'rent', amount: 900_000, label: '월세' }, { categoryId: 'rent', amount: 500_000, label: '학원', childId: 'k1' }],
  variable: [], irregular: [],
}

beforeEach(() => {
  apiFetchMock.mockReset()
  setChild.mockClear()
  childValue = { children: [{ id: 'k1', alias: '첫째', birth: '2018-03', gifts: [] }] }
  apiFetchMock.mockResolvedValue({ entries: [], rules: [], checks: [{ id: 'c1', date: '2026-09-30', label: '', input }] })
})

describe('고정지출 자녀 연결', () => {
  it('자녀를 고른 줄만 자녀별 한 달 비용에 모인다', async () => {
    render(<MemoryRouter initialEntries={['/money-flow?tab=check']}><MoneyFlowPage /></MemoryRouter>)
    const result = await screen.findByLabelText('점검 결과')
    expect(result).toHaveTextContent('자녀별 한 달 비용')
    expect(result).toHaveTextContent('첫째500,000원')
  })

  it('줄에서 자녀를 새로 추가하면 자녀 계좌 저장소에 들어가고 그 줄에 연결된다', async () => {
    render(<MemoryRouter initialEntries={['/money-flow?tab=check']}><MoneyFlowPage /></MemoryRouter>)
    await screen.findByLabelText('점검 결과')
    fireEvent.change(screen.getByLabelText('월세 누구 몫'), { target: { value: '__add' } })
    fireEvent.change(screen.getByLabelText('자녀 별칭'), { target: { value: '둘째' } })
    fireEvent.change(screen.getByLabelText('자녀 태어난 연월'), { target: { value: '2021-05' } })
    fireEvent.click(screen.getByRole('button', { name: '추가하고 고르기' }))
    const saved = setChild.mock.calls[0][0] as { children: Array<{ alias: string; birth: string }> }
    expect(saved.children.map((c) => c.alias)).toEqual(['첫째', '둘째'])
    expect(saved.children[1].birth).toBe('2021-05')
  })
})
