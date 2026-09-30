import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SeedBuilderPage from './index'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({ useCurrentClientId: () => 'test-user' }))

beforeEach(() => {
  apiFetchMock.mockReset()
  apiFetchMock.mockResolvedValue({ data: [] })
})

describe('시드 만들기', () => {
  it('0원부터 시작해 실제 저장 후에만 올해 시드에 반영한다', async () => {
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    const save = await screen.findByRole('button', { name: '이번 달 저장' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.change(screen.getByLabelText(/이번 달 목표/), { target: { value: '50000' } })
    fireEvent.change(screen.getByLabelText(/실제로 모은 돈/), { target: { value: '30000' } })
    expect(screen.getByLabelText('시드 현황')).toHaveTextContent('올해 모은 돈0원')
    fireEvent.click(save)
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ui/seed-builder', expect.objectContaining({ method: 'PUT' })))
    await waitFor(() => expect(screen.getByLabelText('시드 현황')).toHaveTextContent('올해 모은 돈30,000원'))
  })

  it('현금보다 1주 가격이 높으면 대기를 안내한다', async () => {
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: '이번 달 저장' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText(/증권계좌에서 직접 확인한 가용 현금/), { target: { value: '100000' } })
    fireEvent.change(screen.getByLabelText(/관심 종목 또는 ETF의 현재 1주 가격/), { target: { value: '130000' } })
    expect(screen.getByText(/현재 금액으로는 1주를 살 수 없습니다/)).toHaveTextContent('30,000원')
  })

  it('월수입 합계와 별도로 급여일을 입금 순서로 보여준다', async () => {
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: '이번 달 저장' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '맞벌이' }))
    fireEvent.change(screen.getByLabelText(/본인 월수입/), { target: { value: '2000000' } })
    fireEvent.change(screen.getByLabelText(/배우자 월수입/), { target: { value: '1000000' } })
    fireEvent.change(screen.getByLabelText(/본인 급여일/), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText(/배우자 급여일/), { target: { value: '5' } })
    expect(screen.getByText(/5일 배우자 1,000,000원 · 25일 본인 2,000,000원/)).toBeInTheDocument()
    expect(screen.getByText(/월수입 합계 3,000,000원/)).toBeInTheDocument()
  })

  it('저장 실패 시 올해 시드를 증가시키지 않는다', async () => {
    apiFetchMock.mockImplementation((_path: string, options?: { method?: string }) => options?.method === 'PUT' ? Promise.reject(new Error('저장 오류')) : Promise.resolve({ data: [] }))
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    const save = screen.getByRole('button', { name: '이번 달 저장' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.change(screen.getByLabelText(/실제로 모은 돈/), { target: { value: '30000' } })
    fireEvent.click(save)
    await screen.findByText(/저장 실패: 저장 오류/)
    expect(screen.getByLabelText('시드 현황')).toHaveTextContent('올해 모은 돈0원')
  })

  it('저장된 두 달이 있을 때만 큰 지출 변화와 추가 원금을 표시한다', async () => {
    const today = new Date()
    const year = today.getFullYear()
    const month = today.getMonth() + 1
    if (month < 2) return
    const currentMonth = `${year}-${String(month).padStart(2, '0')}`
    const previousMonth = `${year}-${String(month - 1).padStart(2, '0')}`
    const expenses = { food: 100000, housing: 0, vehicle: 0, education: 0, tax: 0, subscriptions: 10000, other: 0 }
    apiFetchMock.mockResolvedValue({ data: [
      { month: previousMonth, household: 'solo', ownIncome: 2000000, partnerIncome: 0, expenses, reserve: 0, plan: 50000, saved: 20000 },
      { month: currentMonth, household: 'solo', ownIncome: 2000000, partnerIncome: 0, expenses: { ...expenses, subscriptions: 30000 }, reserve: 0, plan: 50000, saved: 30000 },
    ] })
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await screen.findByText(/통신·구독 지출이 지난달보다 20,000원 늘었습니다/)
    expect(screen.getByText(/1년 추가 원금은 120,000원/)).toBeInTheDocument()
    expect(screen.getByLabelText('시드 현황')).toHaveTextContent('올해 모은 돈50,000원')
    expect(screen.getByText(/월간 계산상 여력 1,870,000원/)).toBeInTheDocument()
    expect(screen.getByText(/새 달 수입·카드대금·고정비·비정기 항목은 자동으로 가져오지 않으며/)).toBeInTheDocument()
    expect(screen.getByText(/지난달 대비 투자 여력/)).toHaveTextContent('-20,000원')
  })

  it('보너스와 2개월 공과금을 발생한 달에만 더해 전월 여력과 비교한다', async () => {
    const today = new Date()
    if (today.getMonth() === 0) return
    const year = today.getFullYear()
    const currentMonth = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const previousMonth = `${year}-${String(today.getMonth()).padStart(2, '0')}`
    const base = { household: 'solo', ownIncome: 2000000, partnerIncome: 0, reserve: 0, plan: 0, saved: 0,
      expenses: { food: 100000, housing: 0, vehicle: 0, education: 0, tax: 0, subscriptions: 0, other: 0, card: 0 }, extraIncome: { incentive: 0, vacation: 0, taxRefund: 0, other: 0 } }
    apiFetchMock.mockResolvedValue({ data: [{ ...base, month: previousMonth }, { ...base, month: currentMonth,
      extraIncome: { ...base.extraIncome, incentive: 200000 }, expenses: { ...base.expenses, water: 50000 } }] })
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/지난달 대비 투자 여력/)).toHaveTextContent('+150,000원'))
    expect(screen.queryByText(/참고 예산/)).not.toBeInTheDocument()
    expect(screen.getByText(/월수입 합계 2,200,000원/)).toBeInTheDocument()
  })

  it('지출이 수입보다 많으면 적자를 그대로 보여주고 목표 0원으로 쉬게 한다', async () => {
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: '이번 달 저장' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText(/월수입/), { target: { value: '1000000' } })
    fireEvent.change(screen.getByLabelText(/식비·생활/), { target: { value: '1300000' } })
    fireEvent.change(screen.getByLabelText(/이번 달 목표/), { target: { value: '50000' } })
    expect(screen.getByText(/적자 300,000원/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이번 달 목표 0원으로 쉬기' }))
    expect(screen.getByLabelText(/이번 달 목표/)).toHaveValue(null)
  })

  it('저장하지 않은 입력이 있으면 월 이동 전에 인라인으로 묻고 취소할 수 있다', async () => {
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: '이번 달 저장' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText(/이번 달 목표/), { target: { value: '50000' } })
    expect(screen.getByText('저장 안 됨')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('저장하지 않은 입력이 있습니다')
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/이번 달 목표/)).toHaveValue(50000)
  })

  it('기록 없음과 0원 확보를 차트에서 구분한다', async () => {
    const key = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).slice(0, 7)
    apiFetchMock.mockResolvedValue({ data: [{ month: key, household: 'solo', ownIncome: 0, partnerIncome: 0, expenses: {}, reserve: 0, plan: 0, saved: 0 }] })
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('img', { name: /기록 없음/ })).toHaveAccessibleName(/\d+월 0원/))
  })
})
