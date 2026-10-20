import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SavingProgressCard, { type SavingProgressData } from './SavingProgressCard'
import { currentYmKst } from '../../lib/accumulate'
import { userScopedKey } from '../../lib/userState'

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

  it('이번 달 기록은 홈 할 일 한 곳에서만 — 여기는 상태만 보여 주고 체크인 버튼이 없다', async () => {
    apiFetchMock.mockResolvedValue({ data: data() })
    renderCard('full')
    expect(await screen.findByText(/이번 달을 넣으면 2개월/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /이번 달 넣었어요/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /이번 달 할 일은 홈에서/ })).toBeInTheDocument()
  })

  it('홈에서 "샀어요"로 답한 달은 산 상품·수량으로 보이고 이어서 넣은 달에 센다', async () => {
    window.localStorage.setItem(userScopedKey('state:accumulate')!, JSON.stringify({
      value: { deposits: [[ym, 1_000_000]], tasks: { [ym]: { status: 'bought', name: 'KIWOOM 200TR', qty: 10, amount: 1_000_000, at: 'x' } } },
      updatedAt: Date.now(),
    }))
    apiFetchMock.mockResolvedValue({ data: data() })
    renderCard()
    expect(await screen.findByText(/이번 달 샀어요 · KIWOOM 200TR 10주/)).toBeInTheDocument()
    expect(screen.getByText('2개월')).toBeInTheDocument()
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

  // 원금 5,950만 × 4% ÷ 12 = 월 약 19.8만 → 휴대폰(누적 8만)은 넘고 보험(누적 23만)의 86%
  const fixed = [{ label: '관리비', amount: 250_000 }, { label: '휴대폰', amount: 80_000 }, { label: '보험', amount: 150_000 }]

  it('고정비 사다리: 홈은 넘은 칸과 다음 칸 한 줄, 모아가기는 전체 계단과 계산 근거', async () => {
    apiFetchMock.mockResolvedValue({ data: data({ ladder: { fixed, withdrawalPct: 4, addedThisMonth: 0 } }) })
    const { unmount } = renderCard('home')
    expect(await screen.findByText('월 20만원')).toBeInTheDocument()
    expect(screen.getByText(/다음 보험 86%/)).toBeInTheDocument()
    expect(screen.queryByText(/누적 48만원/)).not.toBeInTheDocument()
    expect(screen.queryByText(/이번 달로/)).not.toBeInTheDocument()
    unmount()
    renderCard('full')
    expect(await screen.findByText(/누적 23만원의 86%/)).toBeInTheDocument()
    expect(screen.getByText(/누적 48만원/)).toBeInTheDocument()
    expect(screen.getByText(/넣은 원금 × 연 4% ÷ 12/)).toBeInTheDocument()
  })

  it('고정비 사다리: 이번 달 넣은 돈으로 새 칸을 넘으면 한 줄로 알려 준다', async () => {
    apiFetchMock.mockResolvedValue({ data: data({ ladder: { fixed, withdrawalPct: 4, addedThisMonth: 40_000_000 } }) })
    renderCard()
    expect(await screen.findByText(/이번 달로 휴대폰까지 넘었어요/)).toBeInTheDocument()
  })

  it('고정비 사다리: 예산 기록이 없으면 예산으로 안내, 조회 실패(null)면 숨긴다', async () => {
    apiFetchMock.mockResolvedValue({ data: data({ ladder: { fixed: [], withdrawalPct: 4, addedThisMonth: 0 } }) })
    const { unmount } = renderCard()
    expect(await screen.findByRole('button', { name: /예산에 고정지출을 적으면/ })).toBeInTheDocument()
    unmount()
    apiFetchMock.mockResolvedValue({ data: data({ ladder: { fixed: null, withdrawalPct: 4, addedThisMonth: 0 } }) })
    renderCard()
    await screen.findByText('5,950만원')
    expect(screen.queryByText(/대신 내 주는 고정비/)).not.toBeInTheDocument()
  })

  it('시장이 10% 넘게 빠진 달에 넣었으면 그 횟수를 센다(넣지 않은 빠진 달은 세지 않음)', async () => {
    apiFetchMock.mockResolvedValue({ data: data({ dropMonths: { months: ['2025-04', prev], since: '2025-03' } }) })
    renderCard()
    expect(await screen.findByText(/빠진 달에도/)).toHaveTextContent('코스피가 고점보다 10% 넘게 빠진 달에도 1번 넣었어요')
  })

  it('응답 모양이 다르면(빈 data) 아무것도 그리지 않는다', async () => {
    apiFetchMock.mockResolvedValue({ data: {} })
    const { container } = renderCard()
    await new Promise((r) => setTimeout(r, 0))
    expect(container.textContent).toBe('')
  })
})
