import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BacktestPage from './index'

// 분해 전에 현재 동작을 고정하는 스모크 테스트. API·종목 검색은 전부 가짜다.
const RISERS = [
  { code: '000001', name: '가나다', asof: '2026-08-01', totalScore: 72.5, signal: 'BUY', rsi14: 55, forwardReturnPct: 25.5 },
  { code: '000002', name: '라마바', asof: '2026-08-05', totalScore: 61, signal: 'WATCH', rsi14: 40, forwardReturnPct: 31.2 },
  { code: '000003', name: '사아자', asof: '2026-07-20', totalScore: 80, signal: 'BUY', rsi14: null, forwardReturnPct: 22.1 },
]
const BACKTEST = {
  params: { horizonBars: 20, lookbackDays: 120, rallyThresholdPct: 20, topN: 30 },
  availableHorizons: [20, 40, 60],
  baseline: { labelableEvents: 12345, score70RatePct: 20, buySignalRatePct: 30, avgForwardReturnPct: 1.5 },
  riserSummary: { riserEvents: 321, avgForwardReturnPct: 26.3 },
  commonFeatures: { score70RatePct: 45, score70LiftPct: 25, buySignalRatePct: 60, buySignalLiftPct: 30, rsi45to65RatePct: 40 },
  featureStats: [],
  ruleCandidates: [
    { key: 'rule_score70_buy', label: '점수70+ BUY', supportPct: 40, liftPct: 20, precisionPct: 15, matchedEvents: 500, riserMatches: 80, matchedAvgReturnPct: 3.2, filter: { scoreMin: 70, buyOnly: true } },
  ],
  risers: RISERS,
}
const INDICATORS = {
  code: '000001', name: '가나다', market: 'KOSPI', close: 10000, score_date: '2026-10-08', total_score: 75, signal: 'BUY',
  indicator_date: '2026-10-08', rsi14: 55, roc21: 5, sma20: 9800, sma50: 9500, sma200: 9000, pullback_date: null,
  entry_grade: 'A', warn_grade: null, dist_pct: 1.2, per: 10, pbr: 1.1, roe: 9, debt_ratio: 50, market_cap: 1_000_000_000_000,
}

type Call = { url: string }
const calls: Call[] = []
let backtestError: string | null = null

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn((url: string) => {
    const u = String(url)
    calls.push({ url: u })
    if (u.startsWith('/api/ui/backtest-risers')) {
      return backtestError ? Promise.reject(new Error(backtestError)) : Promise.resolve({ data: BACKTEST })
    }
    if (u.startsWith('/api/ui/scan-candidates')) return Promise.resolve({ data: [{ code: '000001', name: '가나다', liquidity: 9_000_000_000, intraday_change_pct: 1 }] })
    if (u.startsWith('/api/ui/stock-indicators')) return Promise.resolve({ data: INDICATORS })
    return Promise.resolve({ data: null })
  }),
  invalidateCache: vi.fn(),
}))
vi.mock('../../lib/stockCache', () => ({
  searchStocks: vi.fn(() => Promise.resolve([])),
}))

const callsTo = (prefix: string) => calls.filter((c) => c.url.startsWith(prefix))
const order = (names: string[]) => {
  const text = document.body.textContent || ''
  return names.map((n) => ({ n, i: text.indexOf(n) })).sort((a, b) => a.i - b.i).map((x) => x.n)
}

describe('급등 종목 역추적 백테스트', () => {
  beforeEach(() => {
    calls.length = 0
    backtestError = null
    window.history.replaceState({}, '', '/')
    try { sessionStorage.clear() } catch { /* ignore */ }
  })

  it('마운트하면 기본 파라미터로 백테스트를 불러와 요약을 보여준다', async () => {
    render(<BacktestPage />)
    expect(await screen.findByText('12,345건')).toBeTruthy()
    expect(screen.getByText('321건')).toBeTruthy()
    const url = callsTo('/api/ui/backtest-risers')[0].url
    expect(url).toContain('horizon=20')
    expect(url).toContain('lookbackDays=120')
    expect(url).toContain('rallyPct=20')
    expect(url).toContain('topN=30')
  })

  it('규칙 후보가 있으면 자동 추천을 위해 스캔 후보와 지표를 조회한다', async () => {
    render(<BacktestPage />)
    await screen.findByText('12,345건')
    await waitFor(() => expect(callsTo('/api/ui/scan-candidates').length).toBeGreaterThan(0))
    await waitFor(() => expect(callsTo('/api/ui/stock-indicators?code=000001').length).toBeGreaterThan(0))
  })

  it('재실행은 다시 호출하고, 다른 Horizon을 고르면 쿼리에 반영된다', async () => {
    render(<BacktestPage />)
    await screen.findByText('12,345건')
    fireEvent.click(screen.getByRole('button', { name: '40일' }))
    fireEvent.click(screen.getByRole('button', { name: '재실행' }))
    await waitFor(() => expect(callsTo('/api/ui/backtest-risers')).toHaveLength(2))
    expect(callsTo('/api/ui/backtest-risers')[1].url).toContain('horizon=40')
  })

  it('이벤트 샘플 탭은 수익률 내림차순이 기본이고 헤더로 정렬을 바꾼다', async () => {
    render(<BacktestPage />)
    await screen.findByText('12,345건')
    fireEvent.click(screen.getByRole('button', { name: /이벤트 샘플/ }))
    expect(await screen.findByText('급등 이벤트 샘플')).toBeTruthy()
    expect(order(['라마바', '가나다', '사아자'])).toEqual(['라마바', '가나다', '사아자'])
    fireEvent.click(screen.getByText(/^점수/))
    expect(order(['라마바', '가나다', '사아자'])).toEqual(['사아자', '가나다', '라마바'])
    fireEvent.click(screen.getByText(/^점수/))
    expect(order(['라마바', '가나다', '사아자'])).toEqual(['라마바', '가나다', '사아자'])
  })

  it('샘플 행을 누르면 종목 점검 탭으로 가서 지표를 조회한다', async () => {
    render(<BacktestPage />)
    await screen.findByText('12,345건')
    fireEvent.click(screen.getByRole('button', { name: /이벤트 샘플/ }))
    fireEvent.click(await screen.findByTitle('가나다 패턴 점검'))
    await waitFor(() => expect(callsTo('/api/ui/stock-indicators?code=000001').length).toBeGreaterThan(0))
    const tabBar = document.querySelector('.bt-tab-bar') as HTMLElement
    await waitFor(() => expect(within(tabBar).getAllByText('가나다').length).toBeGreaterThan(0))
  })

  it('조회 실패 시 오류 문구를 보여준다', async () => {
    backtestError = '서버 오류'
    render(<BacktestPage />)
    expect(await screen.findByText('서버 오류')).toBeTruthy()
  })
})
