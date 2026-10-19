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
let monthBuys: unknown[] = []
let positions: unknown[] = []

function setAccumulate(value: unknown) {
  localStorage.setItem(userScopedKey('state:accumulate')!, JSON.stringify({ value, updatedAt: Date.now() }))
}

const posts = () => apiFetchMock.mock.calls.filter(([u, o]) => String(u).startsWith('/api/ui/virtual-trade') && o?.method === 'POST')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-01T03:00:00Z')) // KST 11/1 12:00
  localStorage.clear()
  plan = { monthly: 1_220_000, depositDay: 1 }
  tradeResult = { ok: true }
  monthBuys = []
  positions = []
  setAccumulate({ target: { code: '294400', name: 'KIWOOM 200TR' } })
  apiFetchMock.mockReset()
  apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
    if (url.startsWith('/api/ui/investment-prefs')) return Promise.resolve({ data: { plan } })
    // 일봉 이력이 없는 ETF처럼 data의 close는 0이고 실시간가는 latest에 온다(운영 응답 모양)
    if (url.startsWith('/api/ui/stock-latest')) return Promise.resolve({ data: [{ date: '2026-10-31', close: 0 }], latest: { date: '2026-10-31', close: 93_850 } })
    if (url.includes('route=saving-progress')) return Promise.resolve({ data: { monthBuys } })
    if (url.startsWith('/api/ui/positions')) return Promise.resolve(positions)
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
  it('샀어요는 바로 저장하지 않고 수량·체결가·계좌를 확인한 뒤 저장한다 (첫 매수는 계좌 이름을 받는다)', async () => {
    renderCard()
    expect(await screen.findByText('11월 할 일')).toBeInTheDocument()
    expect(screen.getByText('KIWOOM 200TR 12주')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음 달부터 시작' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '샀어요' }))
    expect(posts()).toHaveLength(0)
    expect((screen.getByLabelText('산 수량(주)') as HTMLInputElement).value).toBe('12')
    expect((screen.getByLabelText(/^체결 가격\(원\)/) as HTMLInputElement).value).toBe('93850')

    // 계좌 이름 없이 저장하면 막는다
    fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('계좌 이름')
    expect(posts()).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('체결 가격(원)', { exact: false }), { target: { value: '94100' } })
    fireEvent.change(screen.getByLabelText('증권사'), { target: { value: '키움' } })
    fireEvent.change(screen.getByLabelText('계좌 이름'), { target: { value: '일반' } })
    fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' }))
    expect(await screen.findByText(/11월 완료 · KIWOOM 200TR 12주/)).toBeInTheDocument()
    expect(JSON.parse(posts()[0][1].body)).toMatchObject({ code: '294400', side: 'BUY', quantity: 12, price: 94_100, broker_name: '키움', account_name: '일반' })
  })

  it('실계좌가 있으면 계좌를 고르고, 저장 실패면 완료로 바꾸지 않는다', async () => {
    positions = [{ code: '069500', broker_name: '토스', account_name: 'ISA' }]
    tradeResult = new Error('network')
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: '샀어요' }))
    expect(screen.getByLabelText('산 계좌')).toHaveDisplayValue('토스 · ISA')
    expect(screen.queryByLabelText('계좌 이름')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('기록하지 못했습니다')
    expect(screen.getByText('11월 할 일')).toBeInTheDocument()
    expect(JSON.parse(posts()[0][1].body)).toMatchObject({ broker_name: '토스', account_name: 'ISA' })
  })

  it('포트폴리오에 이번 달 매수가 있으면 "이걸로 완료" — 새 거래를 만들지 않는다', async () => {
    monthBuys = [
      { code: '294400', quantity: 4, price: 118_000, tradedAt: '2026-11-01T01:00:00Z', broker: '키움', account: '일반', memo: null },
      { code: '294400', quantity: 6, price: 117_000, tradedAt: '2026-11-01T02:00:00Z', broker: '키움', account: '일반', memo: null },
    ]
    renderCard()
    expect(await screen.findByText(/포트폴리오에 이번 달 매수가 있어요/)).toBeInTheDocument()
    expect(screen.getByText('KIWOOM 200TR 10주')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이걸로 완료' }))
    expect(await screen.findByText(/11월 완료 · KIWOOM 200TR 10주/)).toBeInTheDocument()
    expect(posts()).toHaveLength(0)
  })

  it('이번 달 매수가 있어도 더 살 사람은 할 일 카드로', async () => {
    monthBuys = [{ code: '294400', quantity: 2, price: 118_000, tradedAt: '2026-11-01T01:00:00Z', broker: null, account: '일반', memo: null }]
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: '이번 달에 더 살 거예요' }))
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
    expect(posts()).toHaveLength(0)
  })
})
