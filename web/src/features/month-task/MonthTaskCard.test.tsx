import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MonthTaskCard from './MonthTaskCard'
import { userScopedKey } from '../../lib/userState'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({
  useCurrentClientId: () => 'test-user',
  useCurrentChatId: () => '1',
  getCurrentClientIdFromStore: () => 'test-user',
  getCurrentChatIdFromStore: () => '1',
}))

let plan = { monthly: 1_220_000, depositDay: 1 }
let tradeResult: unknown = { ok: true }

function setAccumulate(value: unknown) {
  localStorage.setItem(userScopedKey('state:accumulate')!, JSON.stringify({ value, updatedAt: Date.now() }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-01T03:00:00Z')) // KST 11/1 12:00
  localStorage.clear()
  plan = { monthly: 1_220_000, depositDay: 1 }
  tradeResult = { ok: true }
  setAccumulate({ target: { code: '294400', name: 'KIWOOM 200TR' } })
  apiFetchMock.mockReset()
  apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
    if (url.startsWith('/api/ui/investment-prefs')) return Promise.resolve({ data: { plan } })
    // 일봉 이력이 없는 ETF처럼 data의 close는 0이고 실시간가는 latest에 온다(운영 응답 모양)
    if (url.startsWith('/api/ui/stock-latest')) return Promise.resolve({ data: [{ date: '2026-10-31', close: 0 }], latest: { date: '2026-10-31', close: 93_850 } })
    if (url.startsWith('/api/ui/positions')) return Promise.resolve([])
    if (url.startsWith('/api/ui/virtual-trade') && opts?.method === 'POST') {
      return tradeResult instanceof Error ? Promise.reject(tradeResult) : Promise.resolve(tradeResult)
    }
    return Promise.reject(new Error(`unmocked ${url}`))
  })
})
afterEach(() => { vi.useRealTimers() })

const renderCard = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><MonthTaskCard /></MemoryRouter>
  </QueryClientProvider>,
)

describe('홈 이번 달 할 일', () => {
  it('넣는 날이면 무엇을 몇 주 살지 보여 주고, 산 기록이 저장된 뒤에만 완료로 접힌다', async () => {
    renderCard()
    expect(await screen.findByText('11월 할 일')).toBeInTheDocument()
    expect(screen.getByText('KIWOOM 200TR 12주')).toBeInTheDocument()
    expect(screen.getByText(/122만원을 넣었다고 보고/)).toBeInTheDocument()
    // 한 번도 답한 적 없으면 '못 함' 대신 '다음 달부터 시작'
    expect(screen.getByRole('button', { name: '다음 달부터 시작' })).toBeInTheDocument()
    expect(screen.getAllByText('실제').length).toBeGreaterThan(0)
    expect(screen.getByText('가상')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '샀어요' }))
    expect(await screen.findByText(/11월 완료 · KIWOOM 200TR 12주/)).toBeInTheDocument()
    const post = apiFetchMock.mock.calls.find(([u, o]) => String(u).startsWith('/api/ui/virtual-trade') && o?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toMatchObject({ code: '294400', side: 'BUY', quantity: 12, price: 93_850, broker_name: '직접 입력', account_name: '실계좌' })
  })

  it('저장이 실패하면 완료로 바꾸지 않고 알린다', async () => {
    tradeResult = new Error('network')
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: '샀어요' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('기록하지 못했습니다')
    expect(screen.getByText('11월 할 일')).toBeInTheDocument()
  })

  it('넣는 날 전에는 한 줄 예정만', async () => {
    plan = { monthly: 1_220_000, depositDay: 25 }
    renderCard()
    expect(await screen.findByText(/다음 할 일 11\/25 · KIWOOM 200TR 약 12주/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '샀어요' })).not.toBeInTheDocument()
  })

  it('지난달에 답했으면 이번 달은 "못 함"을 고를 수 있고, 고르면 한 줄로 접힌다', async () => {
    setAccumulate({ target: { code: '294400', name: 'KIWOOM 200TR' }, tasks: { '2026-10': { status: 'later', at: 'x' } } })
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: '이번 달은 못 함' }))
    await waitFor(() => expect(screen.getByText(/11월은 건너뛰었어요/)).toBeInTheDocument())
    expect(apiFetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/ui/virtual-trade'))).toBe(false)
  })

  it('다르게 샀어요: 수량·가격을 고쳐 기록', async () => {
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: '다르게 샀어요' }))
    fireEvent.change(screen.getByLabelText('산 수량(주)'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('체결 가격(원)'), { target: { value: '94000' } })
    fireEvent.click(screen.getByRole('button', { name: '기록' }))
    expect(await screen.findByText(/11월 완료 · KIWOOM 200TR 10주/)).toBeInTheDocument()
  })
})
