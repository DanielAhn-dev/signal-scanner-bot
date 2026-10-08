import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MoneyFlowPage from './index'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({ useCurrentClientId: () => 'test-user', getCurrentClientIdFromStore: () => 'test-user' }))

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const plusDays = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

beforeEach(() => {
  apiFetchMock.mockReset()
  apiFetchMock.mockResolvedValue({ entries: [], rules: [], checks: [], data: {} })
  localStorage.clear()
})

const renderTab = () => render(<MemoryRouter initialEntries={['/money-flow?tab=maturity']}><MoneyFlowPage /></MemoryRouter>)

function addItem(name: string, manwon: string, date: string, horizon?: string) {
  fireEvent.change(screen.getByLabelText('이름 (예: OO적금)'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('만기 때 받을 금액 (만원)'), { target: { value: manwon } })
  fireEvent.change(screen.getByLabelText('만기일'), { target: { value: date } })
  if (horizon) fireEvent.change(screen.getByLabelText('이 돈을 쓸 시점'), { target: { value: horizon } })
  fireEvent.click(screen.getByRole('button', { name: '추가' }))
}

describe('만기 예·적금 탭', () => {
  it('?tab=maturity로 바로 열리고, 입력이 비면 추가할 수 없다', () => {
    renderTab()
    expect(screen.getByText('만기 예·적금, 어디로 보낼지 미리')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '추가' })).toBeDisabled()
  })

  it('추가하면 만기 순으로 보이고 D-day와 남은 합계가 나온다', () => {
    renderTab()
    addItem('B적금', '2000', plusDays(40))
    addItem('A예금', '1000', plusDays(5), 'over5')
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('A예금')
    expect(rows[0]).toHaveTextContent('D-5')
    expect(rows[0]).toHaveTextContent('곧 만기')
    expect(rows[1]).toHaveTextContent('B적금')
    expect(rows[1]).toHaveTextContent('D-40')
    expect(screen.getByText(/남은 만기/)).toHaveTextContent('2건 · 3,000만원')
    expect(screen.getByText(/가장 가까운 것은/)).toHaveTextContent('A예금 D-5')
  })

  it('갈 곳 보기: 5년 넘게는 KODEX 200TR, 3년 안은 지수에 넣지 않음', () => {
    renderTab()
    addItem('장기', '1000', plusDays(10), 'over5')
    addItem('단기', '500', plusDays(20), 'under3')
    const [long, short] = screen.getAllByRole('listitem')
    fireEvent.click(long.querySelector('button[aria-expanded]')!)
    expect(long).toHaveTextContent('KODEX 200TR(일반계좌)에 입금된 날 한 번에 넣습니다')
    fireEvent.click(short.querySelector('button[aria-expanded]')!)
    expect(short).toHaveTextContent('지수에 넣지 않고')
    expect(short).not.toHaveTextContent('KODEX 200TR')
  })

  it('처리했어요를 누르면 맨 아래로 가고 합계에서 빠지며, 삭제할 수 있다', () => {
    renderTab()
    addItem('먼저', '1000', plusDays(3))
    addItem('나중', '2000', plusDays(30))
    fireEvent.click(screen.getAllByRole('button', { name: '처리했어요' })[0])
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('나중')
    expect(rows[1]).toHaveTextContent('먼저')
    expect(rows[1]).toHaveTextContent('처리함')
    expect(screen.getByText(/남은 만기/)).toHaveTextContent('1건 · 2,000만원')
    fireEvent.click(screen.getByRole('button', { name: '먼저 삭제' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('저장은 서버 user-state의 maturities 키로 보낸다', async () => {
    vi.useFakeTimers()
    try {
      renderTab()
      addItem('적금', '1000', plusDays(10))
      vi.advanceTimersByTime(1000)
    } finally {
      vi.useRealTimers()
    }
    const post = apiFetchMock.mock.calls.find(([path, o]) => path === '/api/ui/user-state' && o?.method === 'POST')
    expect(post).toBeTruthy()
    const body = JSON.parse(post![1].body)
    expect(body.key).toBe('maturities')
    expect(body.value.items).toHaveLength(1)
    expect(body.value.items[0]).toMatchObject({ name: '적금', amount: 10_000_000, horizon: '3to5' })
  })
})
