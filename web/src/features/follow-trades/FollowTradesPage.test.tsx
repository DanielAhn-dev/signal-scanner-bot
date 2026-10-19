import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FollowTradesPage from './index'
import { userScopedKey } from '../../lib/userState'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({
  useCurrentClientId: () => 'test-user',
  useCurrentChatId: () => '1',
  getCurrentClientIdFromStore: () => 'test-user',
  getCurrentChatIdFromStore: () => '1',
}))

const emptyComparison = {
  followed: { chunks: 0, invested: 0, actualPnl: 0, botPricePnl: 0, returnPct: null },
  own: { chunks: 0, invested: 0, actualPnl: 0, botPricePnl: 0, returnPct: null },
  followedTradeCount: 0, ownTradeCount: 0, actualPnl: 0, botPricePnl: 0, priceEffect: 0,
  slippage: [], missed: [], missedAvgReturnPct: null, unpriced: 0,
}

function setAccumulate(value: unknown) {
  localStorage.setItem(userScopedKey('state:accumulate')!, JSON.stringify({ value, updatedAt: Date.now() }))
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><FollowTradesPage /></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  localStorage.clear()
  apiFetchMock.mockReset()
  apiFetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/ui/investment-prefs')) return Promise.resolve({ data: { plan: { monthly: 1_000_000, depositDay: 1 } } })
    if (url.startsWith('/api/ui/follow-report')) return Promise.resolve({ data: { windowDays: 90, bot: [], real: [], prices: {}, comparison: emptyComparison, generatedAt: '2026-12-05T00:00:00Z' } })
    return Promise.reject(new Error(`unmocked ${url}`))
  })
})

describe('따라 사기 — 계획 vs 실제', () => {
  it('지킨 달 n/m을 표 위에, later는 분모에서 빼고, 결산은 표 아래', async () => {
    setAccumulate({
      tasks: {
        '2026-10': { status: 'later', at: 'x' },
        '2026-11': { status: 'bought', code: '294400', name: 'KIWOOM 200TR', qty: 10, price: 95_000, amount: 1_000_000, at: 'x' },
        '2026-12': { status: 'skipped', at: 'x' },
      },
    })
    renderPage()
    expect(await screen.findByText('1/2')).toBeTruthy()
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows[1].textContent).toContain('2026년 12월')
    expect(rows[1].textContent).toContain('건너뜀')
    expect(rows[2].textContent).toContain('KIWOOM 200TR 10주')
    expect(rows[2].textContent).toContain('지킴')
    expect(rows[3].textContent).toContain('다음 달부터 시작')
    expect(rows[3].textContent).toContain('시작 전')
    // 결산 제목이 계획 vs 실제보다 뒤에 온다
    const pva = screen.getByRole('heading', { name: /계획 vs 실제/ })
    const report = await screen.findByRole('heading', { name: /따라 샀어요 결산/ })
    expect(pva.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('기록이 없으면 빈 상태 안내', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/이번 달 할 일'에 답하면/)).toBeTruthy())
    expect(screen.queryByText(/계획을 지킨 달/)).toBeNull()
  })
})
