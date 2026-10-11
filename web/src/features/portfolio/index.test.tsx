import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ToastProvider'
import Portfolio from './index'

const SHARE = { shareId: 's1', url: 'https://example.test/share/abc', expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-10-11T00:00:00Z' }
const sharesCreated: typeof SHARE[] = []

const ROWS = [
  {
    id: 1, position_type: 'holding', code: '005930', stock_name: '삼성전자', quantity: 10, avg_price: 70000,
    unrealized_pnl: 50000, unrealized_pct: 7.1, broker_name: '키움', account_name: '일반', buy_date: '2026-09-01',
    total_score: 75, score_signal: 'BUY', entry_grade: 'A', trend_grade: 'B', warn_grade: 'SAFE', recommended_buy_qty: 2,
    stock: { close: 75000 },
  },
  {
    id: 2, position_type: 'holding', code: '069500', stock_name: 'KODEX 200', quantity: 5, avg_price: 40000,
    unrealized_pnl: -10000, unrealized_pct: -5, broker_name: '', account_name: '', buy_date: '2026-09-10',
    stock: { close: 38000 },
  },
]

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string }) => {
    if (String(url).startsWith('/api/ui/positions?')) {
      return { data: ROWS, count: ROWS.length, accounts: [{ brokerName: '키움', accountName: '일반', count: 1 }] }
    }
    if (String(url).startsWith('/api/ui/portfolio-share')) {
      // 만든 링크가 이력에 나타나야 화면이 새로 만들기를 멈춘다(실제 서버와 같은 동작)
      if (opts?.method === 'POST') sharesCreated.push(SHARE)
      return { data: [...sharesCreated], url: SHARE.url, expiresAt: SHARE.expiresAt }
    }
    return { data: null }
  }),
  invalidateCache: vi.fn(),
}))

const cardNames = (c: HTMLElement) => Array.from(c.querySelectorAll('.portfolio-position-card .title-lg')).map((e) => e.textContent)

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Portfolio />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('포트폴리오 화면', () => {
  beforeEach(() => { sharesCreated.length = 0; try { localStorage.clear() } catch { /* ignore */ } })

  it('보유 종목 카드와 상단 합계를 보여준다', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(cardNames(container)).toEqual(['삼성전자', 'KODEX 200']))
    expect(screen.getByText('보유 종목')).toBeTruthy()
    expect(screen.getByText('키움 / 일반 (1)')).toBeTruthy()
  })

  it('계좌 탭을 누르면 해당 계좌 종목만 남는다', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(cardNames(container)).toHaveLength(2))
    fireEvent.click(screen.getByText('키움 / 일반 (1)'))
    await waitFor(() => expect(cardNames(container)).toEqual(['삼성전자']))
  })

  it('추가매수 버튼이 매매 모달을 연다', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(cardNames(container)).toHaveLength(2))
    fireEvent.click(screen.getAllByText('추가매수')[0])
    expect(await screen.findByText(/현재 매수 내역: 10주/)).toBeTruthy()
    expect(screen.getByText('실행')).toBeTruthy()
  })

  it('필터 & 옵션을 펼치면 보유 상태 필터가 보인다', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(cardNames(container)).toHaveLength(2))
    fireEvent.click(screen.getByText('필터 & 옵션'))
    expect(screen.getByText('보유 상태')).toBeTruthy()
    fireEvent.click(screen.getByText('추가매수(IN진입)'))
    await waitFor(() => expect(cardNames(container)).toEqual(['삼성전자']))
  })

  it('계좌/보유 추가가 유지보수 모달 1단계를 연다', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(cardNames(container)).toHaveLength(2))
    fireEvent.click(screen.getByText('계좌/보유 추가'))
    expect(await screen.findByText('1단계 · 계좌 설정')).toBeTruthy()
  })

  it('공유 요약 보기가 공유 모달을 열고 공유 URL을 만든다', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(cardNames(container)).toHaveLength(2))
    fireEvent.click(screen.getByText('공유 요약 보기'))
    expect(await screen.findByText('최근 공유 링크')).toBeTruthy()
    await waitFor(() => expect((document.querySelector('.portfolio-share-url-input') as HTMLInputElement)?.value).toBe('https://example.test/share/abc'))
  })
})
