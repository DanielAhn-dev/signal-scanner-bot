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

let plan: { monthly: number; depositDay: number; mix?: unknown } = { monthly: 1_220_000, depositDay: 1 }
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
    if (url.startsWith('/api/ui/stock-latest?code=360750')) return Promise.resolve({ data: [], latest: { date: '2026-10-31', close: 24_000 } })
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

  describe('내 계획 구성(여러 지수)', () => {
    const half = [
      { index: 'kospi200', weight: 0.5, product: null, account: null },
      { index: 'sp500', weight: 0.5, product: { code: '360750', name: 'TIGER 미국S&P500' }, account: { broker: '토스', account: 'ISA' } },
    ]

    it('지수마다 한 줄 — 계획 × 비중, 기억한 계좌, 줄마다 실계좌 매수로 저장', async () => {
      plan = { monthly: 1_220_000, depositDay: 1, mix: half }
      positions = [{ code: '069500', broker_name: '키움', account_name: '일반' }, { code: '360750', broker_name: '토스', account_name: 'ISA' }]
      renderCard()
      // 61만원씩: KIWOOM 200TR 6주(93,850원), TIGER 미국S&P500 25주(24,000원)
      expect(await screen.findByText('TIGER 미국S&P500 25주')).toBeInTheDocument()
      expect(screen.getByText('KIWOOM 200TR 6주')).toBeInTheDocument()
      expect(screen.getByText(/S&P500 50% · 61만원 · 토스 · ISA에서/)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: '샀어요' }))
      expect(screen.getByLabelText('S&P500 산 계좌')).toHaveDisplayValue('토스 · ISA')
      expect(screen.getByLabelText('코스피200 산 계좌')).toHaveDisplayValue('키움 · 일반')
      fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' }))
      expect(await screen.findByText(/11월 완료 · KIWOOM 200TR 6주, TIGER 미국S&P500 25주/)).toBeInTheDocument()
      expect(posts().map(([, o]) => JSON.parse(o.body)).map((b) => [b.code, b.quantity, b.account_name])).toEqual([['294400', 6, '일반'], ['360750', 25, 'ISA']])
      const saved = JSON.parse(localStorage.getItem(userScopedKey('state:accumulate')!)!).value.tasks['2026-11']
      expect(saved.lines.map((l: any) => [l.code, l.qty, l.planAmount])).toEqual([['294400', 6, 610_000], ['360750', 25, 610_000]])
      // 코스피200 줄에 고른 계좌를 구성에 기억한다
      await waitFor(() => expect(apiFetchMock.mock.calls.some(([u, o]) => String(u).startsWith('/api/ui/investment-prefs') && o?.method === 'POST')).toBe(true))
      const memo = apiFetchMock.mock.calls.find(([u, o]) => String(u).startsWith('/api/ui/investment-prefs') && o?.method === 'POST')!
      expect(JSON.parse(memo[1].body).plan.mix[0].account).toEqual({ broker: '키움', account: '일반' })
    })

    it('구성에 고른 코스피200 상품이 있으면 추천 대신 그 상품으로 안내한다', async () => {
      plan = { monthly: 1_220_000, depositDay: 1, mix: [{ ...half[0], product: { code: '069500', name: 'KODEX 200' } }, half[1]] }
      renderCard()
      expect(await screen.findByText(/^KODEX 200( \d+주)?$/)).toBeInTheDocument()
      expect(screen.queryByText(/KIWOOM 200TR/)).toBeNull()
    })

    it('안 산 줄은 0주로 건너뛰고, 중간에 실패하면 저장된 줄은 다시 보내지 않는다', async () => {
      plan = { monthly: 1_220_000, depositDay: 1, mix: half }
      positions = [{ code: '069500', broker_name: '키움', account_name: '일반' }]
      let n = 0
      const base = apiFetchMock.getMockImplementation()!
      apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
        if (url.startsWith('/api/ui/virtual-trade') && opts?.method === 'POST') return ++n === 2 ? Promise.reject(new Error('network')) : Promise.resolve({ ok: true })
        return base(url, opts)
      })
      renderCard()
      fireEvent.click(await screen.findByRole('button', { name: '샀어요' }))
      fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('앞의 1줄은 저장됐어요')
      expect(screen.getByText('11월 할 일')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' }))
      expect(await screen.findByText(/11월 완료/)).toBeInTheDocument()
      expect(posts().map(([, o]) => JSON.parse(o.body).code)).toEqual(['294400', '360750', '360750'])
    })

    it('한 줄만 산 달 — 다른 줄은 0주', async () => {
      plan = { monthly: 1_220_000, depositDay: 1, mix: half }
      positions = [{ code: '069500', broker_name: '키움', account_name: '일반' }]
      renderCard()
      fireEvent.click(await screen.findByRole('button', { name: '샀어요' }))
      fireEvent.change(screen.getByLabelText('S&P500 산 수량(주)'), { target: { value: '0' } })
      fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' }))
      expect(await screen.findByText(/11월 완료 · KIWOOM 200TR 6주/)).toBeInTheDocument()
      expect(posts()).toHaveLength(1)
    })
  })
})
