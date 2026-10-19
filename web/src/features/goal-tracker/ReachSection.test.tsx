import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ReachSection from './ReachSection'
import type { GoalView } from './useGoalTracker'

vi.mock('../../stores/profileStore', () => ({
  useCurrentClientId: () => 'test-user',
  getCurrentClientIdFromStore: () => 'test-user',
}))
vi.mock('../../lib/api', () => ({ apiFetch: vi.fn(() => Promise.resolve({})) }))

const view = (patch: Partial<GoalView> = {}): GoalView => ({
  today: '2026-10-19',
  settings: { startDate: '2026-09-29', startEquity: 20_000_000, planAnnualPct: 8, targetMonthlyProfit: 1_000_000, monthlyContribution: 1_000_000 },
  equity: 60_000_000,
  plan: { monthsElapsed: 1, planValue: 20_100_000, gapPct: 0 },
  target: { requiredSeed: 300_000_000, progressPct: 20, monthsToReach: 120, etaMonth: '2036-10' },
  thisMonth: { expectedProfit: 0, returnPct: null, realizedSwing: 0, realizedSweep: 0, sells: 0, wins: 0, assessment: null },
  phase: { stage: 1, title: '1차', text: '' },
  currentMonthlyProfit: 0,
  currentMonthlyWithdrawal: 0,
  schedule: [],
  normalRange: { plusMonthsPct: 56, p10: -8, worst: -27, maxLosingStreak: 6, source: 'x' },
  basis: {
    assetSource: 'real',
    ratePct: 9.9,
    rateSource: 'history',
    rates: { typicalPct: 9.9, lowPct: 7.9, years: 15, from: '2003-12', asOf: '2026-09', label: '코스피200 50 · S&P500 50' },
    etaLowMonth: '2038-01',
    etaAssumedMonth: '2037-03',
    virtualEquity: 20_400_000,
  },
  ...patch,
})

const renderIt = (v: GoalView) => render(<MemoryRouter><ReachSection view={v} onSavePlan={() => {}} saveMsg={null} /></MemoryRouter>)

describe('목표 트래커 · 내 계획이면 언제 닿나', () => {
  it('기준 한 줄(실제 계좌·내 구성 이력), n년 뒤 보통/운 나쁨과 오늘 물가, 더 빨리 닿는 선택지', () => {
    renderIt(view())
    expect(screen.getByText(/내 구성\(코스피200 50 · S&P500 50\) 2003-12~ 이력 보통 연 9.9%·운 나쁨 7.9%/)).toBeInTheDocument()
    expect(screen.getByText('실제')).toBeInTheDocument()
    expect(screen.getByText(/10년 뒤 보통/)).toBeInTheDocument()
    expect(screen.getByText(/오늘 물가로 보면/)).toBeInTheDocument()
    expect(screen.getByText('더 빨리 닿는 선택지')).toBeInTheDocument()
    expect(screen.queryByText(/이력이 .+년부터라 짧고/)).toBeNull()
  })

  it('구성 비중이 오면 경우의 수로 본 목표 이상 비율 한 줄 — 기간을 바꾸면 다시 계산', () => {
    const v = view()
    renderIt({ ...v, basis: { ...v.basis!, rates: { ...v.basis!.rates!, weights: [{ index: 'kospi200', weight: 0.5 }, { index: 'sp500', weight: 0.5 }] } } })
    const line = () => screen.getByText(/과거 1년 조각을 섞은 경우 2,000개 중/)
    expect(line()).toHaveTextContent(/10년 뒤 필요 시드 3억원 이상인 경우 \d+%/)
    expect(line()).toHaveTextContent(/예측이 아닙니다/)
    const at10 = line().querySelector('strong')!.textContent
    fireEvent.click(screen.getByRole('radio', { name: '15년' }))
    expect(line()).toHaveTextContent(/15년 뒤 필요 시드/)
    expect(Number(line().querySelector('strong')!.textContent!.replace('%', ''))).toBeGreaterThanOrEqual(Number(at10!.replace('%', '')))
  })

  it('구성 비중이 없는 옛 응답이면 그 줄을 숨긴다', () => {
    renderIt(view())
    expect(screen.queryByText(/과거 1년 조각을 섞은 경우/)).toBeNull()
  })

  it('가정 수익률은 보조 — 켜야 보인다', () => {
    renderIt(view())
    expect(screen.queryByText(/가정 연 8%면/)).toBeNull()
    fireEvent.click(screen.getByLabelText(/내가 가정한 수익률\(연 8%\)로도 보기/))
    expect(screen.getByText(/가정 연 8%면 필요 시드 3억원에 2037-03쯤 닿습니다/)).toBeInTheDocument()
  })

  it('실계좌 기록이 없으면 가상 계좌로 계산했다고 알리고, 짧은 이력 구성은 주의', () => {
    const v = view()
    renderIt({ ...v, basis: { ...v.basis!, assetSource: 'virtual', rates: { ...v.basis!.rates!, from: '2010-10', label: '코스피200 33 · S&P500 33 · 나스닥100 33' } } })
    expect(screen.getByText(/내 계좌 기록이 없어 가상 계좌로 계산했어요/)).toBeInTheDocument()
    expect(screen.getByText(/이력이 2010년부터라 짧고/)).toBeInTheDocument()
  })
})
