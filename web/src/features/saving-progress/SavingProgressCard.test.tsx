import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SavingProgressCard, { type SavingProgressData } from './SavingProgressCard'
import { currentYmKst } from '../../lib/accumulate'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({
  useCurrentClientId: () => 'test-user',
  useCurrentChatId: () => '1',
  getCurrentClientIdFromStore: () => 'test-user',
}))

const ym = currentYmKst()
const prev = (() => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` })()

function data(patch: Partial<SavingProgressData> = {}): SavingProgressData {
  return {
    principal: { cost: 58_000_000, cash: 1_500_000, total: 59_500_000 },
    value: { holdings: 52_000_000, total: 53_500_000, pnlPct: -10.3 },
    holdingCount: 18,
    buyMonths: [prev],
    receipts: { total: 574_488, months: 3, since: '2026-08' },
    tax: { pensionMonthly: 750_000, distribution: { tr: 2_657, isa: 0, pension: 0 }, underlyingYieldPct: 0.96, accountKinds: ['general'] },
    goal: { requiredSeed: 900_000_000, monthlyNeed: 3_000_000 },
    plan: { monthly: 1_000_000, depositDay: 26 },
    market: { asOf: '2026-10-19', fromHighPct: -20 },
    ...patch,
  }
}

beforeEach(() => {
  window.localStorage.clear()
  apiFetchMock.mockReset()
})

const renderCard = (variant: 'home' | 'full' = 'home') => render(<MemoryRouter><SavingProgressCard variant={variant} /></MemoryRouter>)

describe('내 모으기', () => {
  it('넣은 원금을 크게, 평가금은 맨 아래 작게 보여 준다', async () => {
    apiFetchMock.mockResolvedValue({ data: data() })
    renderCard()
    expect(await screen.findByText('5,950만원')).toBeInTheDocument()
    expect(screen.getByText(/시장이 빠져도 줄지 않는 숫자/)).toBeInTheDocument()
    expect(screen.getByText(/평가금 5,350만원 \(-10.3%\) · 월 1회만 확인/)).toBeInTheDocument()
    expect(screen.getByText(/목표 9억원의 6.6%/)).toBeInTheDocument()
  })

  it('이번 달 체크인: 계획 금액으로 한 번에 기록하고, 지난달 매수와 이어서 2개월로 센다. 취소하면 되돌린다', async () => {
    apiFetchMock.mockResolvedValue({ data: data() })
    renderCard()
    expect(await screen.findByText(/이번 달을 넣으면 2개월/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이번 달 넣었어요 (100만원)' }))
    expect(screen.getByText(/이번 달 넣었어요 · 100만원/)).toBeInTheDocument()
    expect(screen.getByText('2개월')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.getByRole('button', { name: '이번 달 넣었어요 (100만원)' })).toBeInTheDocument()
  })

  it('다른 금액으로도 기록할 수 있다', async () => {
    apiFetchMock.mockResolvedValue({ data: data() })
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: '다른 금액' }))
    fireEvent.change(screen.getByLabelText('이번 달 넣은 금액'), { target: { value: '300000' } })
    fireEvent.click(screen.getByRole('button', { name: '기록' }))
    expect(screen.getByText(/이번 달 넣었어요 · 30만원/)).toBeInTheDocument()
  })

  it('하락장이면 같은 돈으로 더 많은 수량을 산다고 알려 준다(−20% → 25%)', async () => {
    apiFetchMock.mockResolvedValue({ data: data() })
    renderCard()
    expect(await screen.findByText(/고점 때보다 약 25% 더 많은 수량/)).toBeInTheDocument()
    apiFetchMock.mockResolvedValue({ data: data({ market: { asOf: '2026-10-19', fromHighPct: -3 } }) })
  })

  it('홈은 세금 한 줄 요약(연금 13.2% + 분배금), 자세히 화면은 계산 근거 표', async () => {
    apiFetchMock.mockResolvedValue({ data: data() })
    const { unmount } = renderCard('home')
    // 75만 × 12 = 900만 × 13.2% = 118.8만 + 2,657원
    expect(await screen.findByText(/1년 약 119만원/)).toBeInTheDocument()
    unmount()
    renderCard('full')
    expect(await screen.findByText('연금저축·IRP 세액공제')).toBeInTheDocument()
    expect(screen.getByText(/119만원 ~ 149만원/)).toBeInTheDocument()
    expect(screen.getByText(/같은 지수 일반형 분배율 0.96%/)).toBeInTheDocument()
  })

  it('예산에 연금이 없으면 세액공제 칸이 예산으로 안내한다', async () => {
    apiFetchMock.mockResolvedValue({ data: data({ tax: { pensionMonthly: 0, distribution: { tr: 0, isa: 0, pension: 0 }, underlyingYieldPct: null, accountKinds: ['general'] } }) })
    renderCard('full')
    expect(await screen.findByRole('button', { name: '예산의 저축에 연금을 적으면 계산됩니다' })).toBeInTheDocument()
  })

  it('응답 모양이 다르면(빈 data) 아무것도 그리지 않는다', async () => {
    apiFetchMock.mockResolvedValue({ data: {} })
    const { container } = renderCard()
    await new Promise((r) => setTimeout(r, 0))
    expect(container.textContent).toBe('')
  })
})
