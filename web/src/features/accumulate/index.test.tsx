import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccumulatePage from './index'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({
  useCurrentClientId: () => 'test-user',
  useCurrentChatId: () => null,
  useProfileStore: (sel: (st: { isAdmin: boolean }) => unknown) => sel({ isAdmin: false }),
  getCurrentClientIdFromStore: () => 'test-user',
}))
// 화면 위 '내 모으기'·'내 계획'·목표는 각자 테스트가 있다 — 이 화면 테스트의 대상이 아니다
vi.mock('../saving-progress/SavingProgressCard', () => ({ default: () => null }))
// '내 계획'은 매달 금액만 알린다(onPlanMonthly) — 계산기 처음 값 테스트용
const planMock = vi.hoisted(() => ({ monthly: 0 }))
vi.mock('../my-plan/MyPlanCard', async () => {
  const { useEffect } = await import('react')
  return {
    default: ({ onPlanMonthly }: { onPlanMonthly?: (m: number) => void }) => {
      useEffect(() => { if (planMock.monthly) onPlanMonthly?.(planMock.monthly) }, [onPlanMonthly])
      return null
    },
  }
})
vi.mock('../goal-tracker/useGoalTracker', () => ({ useGoalTracker: () => ({ view: null }) }))
// 종목 검색 입력은 이 화면 테스트의 대상이 아니다
vi.mock('../../components/StockSearchInput', () => ({ default: () => <input aria-label="종목 검색" /> }))

function candles(n: number, close: (i: number) => number) {
  const end = Date.now()
  return Array.from({ length: n }, (_, i) => ({ date: new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10), close: close(i) }))
}

beforeEach(() => {
  planMock.monthly = 0
  window.localStorage.clear()
  apiFetchMock.mockReset()
  apiFetchMock.mockImplementation((path: string) => {
    if (path.startsWith('/api/ui/income-guide')) return Promise.resolve({ data: { total: 50_000_000, distribution: { monthlyNet: 250_000 } } })
    if (path.startsWith('/api/ui/stock-latest')) return Promise.resolve({ data: candles(300, () => 100) })
    return Promise.resolve({ data: {} })
  })
})

const renderPage = () => render(<MemoryRouter><AccumulatePage /></MemoryRouter>)

describe('모아가기', () => {
  it('계산기 처음 값은 내 계획 금액, 고치면 되돌리기 링크', async () => {
    planMock.monthly = 1_220_000
    renderPage()
    await screen.findByText('추천')
    const input = screen.getByLabelText('금액') as HTMLInputElement
    expect(input.value).toBe('1220000')
    expect(screen.getByText(/위 '내 계획'은 바뀌지 않습니다/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /으로 되돌리기/ })).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: '500000' } })
    fireEvent.click(screen.getByRole('button', { name: '내 계획(122만원)으로 되돌리기' }))
    expect(input.value).toBe('1220000')
  })

  it('계획이 없으면 50만원 그대로, 되돌리기 링크 없음', async () => {
    renderPage()
    await screen.findByText('추천')
    expect((screen.getByLabelText('금액') as HTMLInputElement).value).toBe('500000')
    expect(screen.queryByRole('button', { name: /으로 되돌리기/ })).not.toBeInTheDocument()
  })

  it('추천 상품과 과거 시뮬레이션 결과를 보여 준다', async () => {
    renderPage()
    expect(await screen.findByText('추천')).toBeInTheDocument()
    expect(screen.getByText(/KIWOOM 200TR/, { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getAllByText('중앙값').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: /적립 평가금 추이/ })).toBeInTheDocument()
    expect(screen.getByText(/원금의 \+20% 이상/)).toBeInTheDocument()
  })

  it('기간 골라 보기: 금융위기 직전 시작이 기본이고, 가장 깊었던 손실과 다른 시작점 대비 위치를 보여 준다', async () => {
    renderPage()
    await screen.findByText('추천')
    fireEvent.click(screen.getByRole('button', { name: '기간 골라 보기' }))
    expect(screen.getByRole('button', { name: '2008 금융위기 직전' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('끝 평가금')).toBeInTheDocument()
    expect(screen.getByText('가장 깊었던 손실')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /고른 기간의 실제 평가금/ })).toBeInTheDocument()
    expect(screen.getByText(/이보다 결과가 나빴던 경우가/)).toBeInTheDocument()
    // 분포 화면의 TR 비교표는 기간 보기에서 숨긴다
    expect(screen.queryByText('KODEX 200 vs KODEX 200TR')).not.toBeInTheDocument()
  })

  it('목적을 분배금 받기로 바꾸면 일반형을 추천한다', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: '분배금 받기' }))
    await waitFor(() => expect(screen.getByText('추천').parentElement).toHaveTextContent(/TIGER 200|KODEX 200|RISE 200/))
  })

  it('인컴 분배금 모드는 실제 기록이 없으면 추정이라고 밝힌다', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: '인컴 분배금을 성장으로' }))
    expect(await screen.findByText(/추정\(실제 기록 없음\)/)).toBeInTheDocument()
    expect(screen.getAllByText('250,000원').length).toBeGreaterThan(0)
    expect(screen.getByText('월 분배금 기준').nextElementSibling).toHaveTextContent('250,000원')
    expect(screen.getByText(/인컴 자산 .*유지 가정/)).toBeInTheDocument()
  })

  it('시세가 오래되면 상황 안내를 보류한다', async () => {
    apiFetchMock.mockImplementation((path: string) => path.startsWith('/api/ui/stock-latest')
      ? Promise.resolve({ data: candles(300, () => 100).map((c) => ({ ...c, date: '2025-01-01' })) })
      : Promise.resolve({ data: {} }))
    renderPage()
    expect(await screen.findByText(/시세가 오래되어 안내를 보류/)).toBeInTheDocument()
  })

  it('시세 조회에 실패하면 안내를 보류한다', async () => {
    apiFetchMock.mockImplementation((path: string) => path.startsWith('/api/ui/stock-latest') ? Promise.reject(new Error('boom')) : Promise.resolve({ data: {} }))
    renderPage()
    expect(await screen.findByText(/시세를 불러오지 못해 안내를 보류/)).toBeInTheDocument()
  })

  it('기록을 저장하면 목록에 나타나고 진행 중인 달로 표시된다', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText('받은 분배금(세후)'), { target: { value: '244646' } })
    fireEvent.click(screen.getByRole('button', { name: '이 달 기록 저장' }))
    expect(await screen.findByText(/\(진행 중\)/)).toBeInTheDocument()
    expect(screen.getByText('244,646')).toBeInTheDocument()
  })
})
