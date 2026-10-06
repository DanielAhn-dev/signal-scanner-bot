import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SeedBuilderPage from './index'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({ useCurrentClientId: () => 'test-user', getCurrentClientIdFromStore: () => 'test-user', useProfileStore: (select: (state: { isAdmin: boolean }) => unknown) => select({ isAdmin: true }) }))

beforeEach(() => {
  window.localStorage.clear()
  apiFetchMock.mockReset()
  apiFetchMock.mockResolvedValue({ data: [] })
})

// 기록이 하나도 없으면 온보딩이 먼저 보인다. 상세 입력 폼이 필요한 테스트는 여기서 넘어간다.
const openEditor = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '자세히 직접 입력하기' }))
}

describe('시드 만들기', () => {
  it('0원부터 시작해 확보 내역을 서버에 기록한 뒤에만 올해 시드에 반영한다', async () => {
    apiFetchMock.mockImplementation((_path: string, options?: { method?: string }) => options?.method === 'POST' ? Promise.resolve({ ok: true, id: 'entry-1' }) : Promise.resolve({ data: [] }))
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await openEditor()
    const save = await screen.findByRole('button', { name: '이번 달 저장' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.change(screen.getByLabelText(/이번 달 목표/), { target: { value: '50000' } })
    fireEvent.change(screen.getByLabelText(/확보 금액/), { target: { value: '30000' } })
    expect(screen.getByLabelText('시드 현황')).toHaveTextContent('올해 모은 돈0원')
    fireEvent.click(screen.getByRole('button', { name: '+ 확보 기록' }))
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ui/seed-builder', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"action":"add-entry"') })))
    await waitFor(() => expect(screen.getByLabelText('시드 현황')).toHaveTextContent('올해 모은 돈30,000원'))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.getByLabelText('시드 현황')).toHaveTextContent('올해 모은 돈0원'))
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(screen.getByLabelText('시드 현황')).toHaveTextContent('올해 모은 돈30,000원'))
  })

  it('입금 기록은 확보 금액을 넘길 수 없고 저장 후 입금 카드에 반영된다', async () => {
    const key = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).slice(0, 7)
    apiFetchMock.mockImplementation((_path: string, options?: { method?: string }) => options?.method === 'POST' ? Promise.resolve({ ok: true }) : Promise.resolve({ data: [
      { month: key, status: 'recorded', household: 'solo', ownIncome: 0, partnerIncome: 0, expenses: {}, reserve: 0, plan: 50000, entries: [{ id: 'e1', date: `${key}-05`, amount: 30000, deposited: 0, memo: '', cancelled: false }] },
    ] }))
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    const deposit = await screen.findByLabelText(/입금 기록 금액/)
    fireEvent.blur(deposit, { target: { value: '40000' } })
    expect(await screen.findByText(/이 내역의 확보 금액\(30,000원\) 이하/)).toBeInTheDocument()
    fireEvent.blur(deposit, { target: { value: '20000' } })
    await waitFor(() => expect(screen.getByLabelText('시드 현황')).toHaveTextContent('입금 기록20,000원'))
    expect(screen.getByLabelText('시드 현황')).toHaveTextContent('계획의 60%')
  })

  it('기록 없는 달은 건너뛰기로 표시할 수 있고 차트에서 0원과 구분된다', async () => {
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await openEditor()
    const skip = await screen.findByRole('button', { name: '이 달은 건너뛰기' })
    await waitFor(() => expect(skip).toBeEnabled())
    fireEvent.click(skip)
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ui/seed-builder', expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"status":"skipped"') })))
    await waitFor(() => expect(screen.getByRole('img', { name: /건너뜀/ })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '이 달은 건너뛰기' })).not.toBeInTheDocument()
  })

  it('다음 달은 계획만 입력할 수 있고 확보 내역은 막는다', async () => {
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await openEditor()
    await waitFor(() => expect(screen.getByRole('button', { name: '이번 달 저장' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '다음 달' }))
    expect(screen.getByText(/다음 달은 계획만 입력할 수 있습니다/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ 확보 기록' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음 달' })).toBeDisabled()
  })

  it('현금보다 1주 가격이 높으면 대기를 안내한다', async () => {
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await openEditor()
    await waitFor(() => expect(screen.getByRole('button', { name: '이번 달 저장' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText(/증권계좌에서 직접 확인한 가용 현금/), { target: { value: '100000' } })
    fireEvent.change(screen.getByLabelText(/관심 종목 또는 ETF의 현재 1주 가격/), { target: { value: '130000' } })
    expect(screen.getByText(/현재 금액으로는 1주를 살 수 없습니다/)).toHaveTextContent('30,000원')
  })

  it('월수입 합계와 별도로 급여일을 입금 순서로 보여준다', async () => {
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await openEditor()
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
    await openEditor()
    const save = screen.getByRole('button', { name: '이번 달 저장' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.change(screen.getByLabelText(/이번 달 목표/), { target: { value: '30000' } })
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
      { month: previousMonth, household: 'solo', ownIncome: 2000000, partnerIncome: 0, expenses, reserve: 0, plan: 50000, entries: [{ id: 'a', date: `${previousMonth}-10`, amount: 20000, deposited: 0, memo: '', cancelled: false }] },
      { month: currentMonth, household: 'solo', ownIncome: 2000000, partnerIncome: 0, expenses: { ...expenses, subscriptions: 30000 }, reserve: 0, plan: 50000, entries: [{ id: 'b', date: `${currentMonth}-10`, amount: 30000, deposited: 0, memo: '', cancelled: false }] },
    ] })
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await screen.findByText(/통신·구독 지출이 지난달보다 20,000원 늘었습니다/)
    expect(screen.getByText(/1년 추가 원금은 120,000원/)).toBeInTheDocument()
    expect(screen.getByLabelText('시드 현황')).toHaveTextContent('올해 모은 돈50,000원')
    expect(screen.getByText(/월간 계산상 여력 1,870,000원/)).toBeInTheDocument()
    expect(screen.getByText(/새 달 수입·급여일은 우리 집 수입으로 미리 채우고/)).toBeInTheDocument()
    expect(screen.getByText(/지난달 대비 투자 여력/)).toHaveTextContent('-20,000원')
  })

  it('보너스와 2개월 공과금을 발생한 달에만 더해 전월 여력과 비교한다', async () => {
    const today = new Date()
    if (today.getMonth() === 0) return
    const year = today.getFullYear()
    const currentMonth = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const previousMonth = `${year}-${String(today.getMonth()).padStart(2, '0')}`
    const base = { household: 'solo', ownIncome: 2000000, partnerIncome: 0, reserve: 0, plan: 0, status: 'recorded', entries: [],
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
    await openEditor()
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
    await openEditor()
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
    apiFetchMock.mockResolvedValue({ data: [{ month: key, household: 'solo', ownIncome: 0, partnerIncome: 0, expenses: {}, reserve: 0, plan: 0, entries: [] }] })
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('img', { name: /기록 없음/ })).toHaveAccessibleName(/\d+월 0원/))
  })

  it('처음 방문하면 3단계 온보딩으로 저장하고 이후에는 나타나지 않는다', async () => {
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    fireEvent.change(await screen.findByLabelText(/월수입/), { target: { value: '3000000' } })
    expect(screen.getByText('약 300만원')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이번 달 저장' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    fireEvent.change(screen.getByLabelText(/한 달 지출 합계/), { target: { value: '2000000' } })
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    fireEvent.click(screen.getByRole('button', { name: '시작 목표에 5만 원 더하기' }))
    fireEvent.click(screen.getByRole('button', { name: '저장하고 시작' }))
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ui/seed-builder', expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"plan":50000') })))
    expect(await screen.findByRole('button', { name: '이번 달 저장' })).toBeInTheDocument()
    expect(window.localStorage.getItem('seed-builder-onboarded')).toBe('1')
  })

  it('목표 제안 버튼은 누르기 전에는 값을 바꾸지 않고 빠른 증가 버튼이 금액을 더한다', async () => {
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await openEditor()
    fireEvent.change(screen.getByLabelText(/월수입/), { target: { value: '2000000' } })
    fireEvent.change(screen.getByLabelText(/식비·생활/), { target: { value: '1000000' } })
    fireEvent.change(screen.getByLabelText(/남겨둘 돈/), { target: { value: '0' } })
    expect(screen.getByLabelText(/이번 달 목표/)).toHaveValue(null)
    fireEvent.click(screen.getByRole('button', { name: /여력의 30% 채우기 \(300,000원\)/ }))
    expect(screen.getByLabelText(/이번 달 목표/)).toHaveValue(300000)
    fireEvent.click(screen.getByRole('button', { name: '계획금에 1만 원 더하기' }))
    expect(screen.getByLabelText(/이번 달 목표/)).toHaveValue(310000)
    fireEvent.change(screen.getByLabelText(/올해 목표 총액/), { target: { value: '1200000' } })
    const month = Number(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(5, 7))
    const perMonth = Math.ceil(1200000 / (13 - month) / 1000) * 1000
    expect(screen.getByRole('button', { name: `연 목표 역산으로 채우기 (${perMonth.toLocaleString('ko-KR')}원)` })).toBeInTheDocument()
  })

  it('금액 가리기를 켜면 화면의 금액이 가려지고 표로 보기를 제공한다', async () => {
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: '표로 보기' }))
    expect(screen.getByRole('table', { name: /월별 시드/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '금액 가리기' }))
    expect(screen.getByLabelText('시드 현황')).toHaveTextContent('•••••원')
    expect(window.localStorage.getItem('seed-builder-mask')).toBe('1')
  })

  it('전체 삭제는 확인 단계를 거쳐 DELETE로 요청하고 화면 기록을 비운다', async () => {
    const key = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).slice(0, 7)
    apiFetchMock.mockImplementation((_path: string, options?: { method?: string }) => options?.method === 'DELETE' ? Promise.resolve({ ok: true }) : Promise.resolve({ data: [
      { month: key, status: 'recorded', household: 'solo', ownIncome: 0, partnerIncome: 0, expenses: {}, reserve: 0, plan: 0, entries: [{ id: 'e1', date: `${key}-05`, amount: 30000, deposited: 0, memo: '', cancelled: false }] },
    ] }))
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByLabelText('시드 현황')).toHaveTextContent('올해 모은 돈30,000원'))
    fireEvent.click(screen.getByRole('button', { name: '시드 만들기 기록 전체 삭제' }))
    expect(apiFetchMock).not.toHaveBeenCalledWith('/api/ui/seed-builder', expect.objectContaining({ method: 'DELETE' }))
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ui/seed-builder', expect.objectContaining({ method: 'DELETE', body: expect.stringContaining('delete-all') })))
    await waitFor(() => expect(screen.getByLabelText('시드 현황')).toHaveTextContent('올해 모은 돈0원'))
  })

  it('지출 변화는 변동 큰 3개만 기본 표시하고 일시 항목은 반복 지출 안내에서 제외한다', async () => {
    const today = new Date()
    if (today.getMonth() === 0) return
    const year = today.getFullYear()
    const currentMonth = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const previousMonth = `${year}-${String(today.getMonth()).padStart(2, '0')}`
    const base = { status: 'recorded', household: 'solo', ownIncome: 3000000, partnerIncome: 0, reserve: 0, plan: 0, entries: [] }
    apiFetchMock.mockResolvedValue({ data: [{ ...base, month: previousMonth, expenses: {} },
      { ...base, month: currentMonth, expenses: { food: 10000, housing: 20000, education: 30000, other: 40000, water: 500000 } }] })
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await screen.findByRole('button', { name: /전체 5개 항목 보기/ })
    expect(screen.getByText('수도요금(2개월)')).toBeInTheDocument()
    expect(screen.getByText('일시')).toBeInTheDocument()
    expect(document.querySelector('.seed-expense-rows')).not.toHaveTextContent('식비·생활')
    expect(screen.getByText(/기타 지출이 지난달보다 40,000원 늘었습니다/)).toBeInTheDocument()
  })
})

describe('우리 집 수입으로 채우기', () => {
  it('기록 없는 이번 달은 저장된 우리 집 수입으로 채우고, 채운 값만으로는 저장 안 됨 표시를 하지 않는다', async () => {
    const stored = { household: 'dual-income', ownIncome: 3_000_000, partnerIncome: 2_000_000, ownPayday: 25, partnerPayday: 10 }
    apiFetchMock.mockImplementation((path: string) => Promise.resolve(path === '/api/ui/user-state' ? { data: { householdIncome: { value: stored, updatedAt: Date.now() } } } : { data: [] }))
    render(<MemoryRouter><SeedBuilderPage /></MemoryRouter>)
    await waitFor(() => expect((screen.getByLabelText(/배우자 월수입/) as HTMLInputElement).value).toBe('2000000'))
    expect((screen.getByLabelText(/본인 월수입/) as HTMLInputElement).value).toBe('3000000')
    expect(screen.getByRole('button', { name: '맞벌이' })).toHaveAttribute('aria-pressed', 'true')
    await openEditor()
    expect((await screen.findByLabelText(/본인 급여일/) as HTMLInputElement).value).toBe('25')
    expect(screen.queryByText('저장 안 됨')).not.toBeInTheDocument()
  })
})
