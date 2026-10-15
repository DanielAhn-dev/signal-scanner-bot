import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MoneyFlowPage from './index'
import { rowsFromEntries } from './FlowCheck'
import { wizardFromCheck } from '../start-wizard'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({ useCurrentClientId: () => 'test-user', getCurrentClientIdFromStore: () => 'test-user' }))

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const month = today.slice(0, 7)
const savedInput = {
  monthlyIncome: 4_000_000, reserveMonthly: 200_000,
  fixed: [{ categoryId: 'rent', amount: 900_000, label: '월세' }, { categoryId: 'sub_media', amount: 17_000, label: '넷플릭스' }],
  variable: [{ categoryId: 'grocery_basic', amount: 400_000, label: '' }, { categoryId: 'delivery', amount: 150_000, label: '' }],
  irregular: [{ categoryId: 'car', label: '자동차보험', yearlyAmount: 600_000, months: [8] }],
}

beforeEach(() => {
  apiFetchMock.mockReset()
})

const renderCheck = (route = '/money-flow?tab=check') => render(<MemoryRouter initialEntries={[route]}><MoneyFlowPage /></MemoryRouter>)

describe('예산', () => {
  it('지난 점검을 불러와 투자 가능액·최대로 줄이면·10·20년 범위를 보여 준다', async () => {
    apiFetchMock.mockResolvedValue({ entries: [], rules: [], checks: [{ id: 'c1', date: '2026-09-30', label: '9월', input: savedInput }] })
    renderCheck()
    const result = await screen.findByLabelText('점검 결과')
    // 현금 지출 900,000 + 17,000 + 400,000 + 150,000 + 50,000 = 1,517,000 → 4,000,000 − 1,517,000 − 200,000
    expect(result).toHaveTextContent('지금 투자 가능액(월)2,283,000원')
    // 못 줄임: 월세 900,000 + 기본 식재료 400,000 + 보험 월할 50,000
    expect(result).toHaveTextContent('최대로 줄이면2,450,000원')
    expect(result).toHaveTextContent('3개월 405만원')
    expect(screen.getByLabelText('적립 예상')).toHaveTextContent('114만원 (절반)')
    expect(result).toHaveTextContent('8월 60만원')
    expect(result).toHaveTextContent('2026-09-30 점검보다')
  })

  it('항목의 줄일 수 있나를 바꾸면 결과가 바뀌고, 저장은 입력만 보낸다', async () => {
    apiFetchMock.mockImplementation((_p: string, o?: { method?: string }) => Promise.resolve(o?.method === 'POST' ? { ok: true } : { entries: [], rules: [], checks: [{ id: 'c1', date: '2026-09-30', label: '', input: savedInput }] }))
    renderCheck()
    await screen.findByLabelText('점검 결과')
    fireEvent.change(screen.getByLabelText('월세 줄일 수 있나'), { target: { value: 'trim' } })
    expect(screen.getByLabelText('점검 결과')).toHaveTextContent('최대로 줄이면3,350,000원')
    fireEvent.click(screen.getByRole('button', { name: '이 점검 저장' }))
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ui/money-flow', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse(apiFetchMock.mock.calls.find(([, o]) => o?.method === 'POST')![1].body)
    expect(body.action).toBe('save-check')
    expect(body.input.fixed[0]).toMatchObject({ categoryId: 'rent', amount: 900_000, cut: 'trim' })
    expect(body.input.fixed[0].key).toBeUndefined()
  })

  it('기록한 달의 지출로 변동·비정기 줄을 채운다', async () => {
    apiFetchMock.mockResolvedValue({
      rules: [], checks: [],
      entries: [
        { id: 'a', date: `${month}-01`, amount: 15170, memo: '냉동피자', categoryId: 'grocery_ready', cut: null, mustPart: null, payment: 'cash' },
        { id: 'b', date: `${month}-02`, amount: 10000, memo: '냉동만두', categoryId: 'grocery_ready', cut: null, mustPart: null, payment: 'cash' },
      ],
    })
    renderCheck()
    fireEvent.click(await screen.findByRole('button', { name: /기록으로 채우기/ }))
    expect((screen.getByLabelText('간편식·냉동 월 금액') as HTMLInputElement).value).toBe('25170')
  })

  it('기록을 점검 줄로 묶는 규칙: 소분류·결제 수단별, 비정기는 그 달 1년치', () => {
    const rows = rowsFromEntries([
      { date: '2026-10-01', amount: 1000, categoryId: 'cafe', payment: 'cash', cut: null, mustPart: null },
      { date: '2026-10-02', amount: 2000, categoryId: 'cafe', payment: 'point_once', cut: null, mustPart: null },
      { date: '2026-10-03', amount: 3000, categoryId: 'cafe', payment: 'cash', cut: null, mustPart: null },
      { date: '2026-10-04', amount: 500_000, categoryId: 'tax', payment: 'cash', cut: null, mustPart: null },
      { date: '2026-10-05', amount: 55_000, categoryId: 'phone', payment: 'cash', cut: null, mustPart: null },
    ])
    expect(rows.variable.map((r) => [r.categoryId, r.payment, r.amount])).toEqual([['cafe', 'cash', 4000], ['cafe', 'point_once', 2000]])
    expect(rows.irregular[0]).toMatchObject({ categoryId: 'tax', yearlyAmount: 500_000, months: [10] })
    expect(rows.fixed[0]).toMatchObject({ categoryId: 'phone', amount: 55_000 })
  })

  it('시작하기 마법사로 옮길 때는 현금 기준으로 고정·카드값을 나눈다', () => {
    expect(wizardFromCheck({ ...savedInput, variable: [...savedInput.variable, { categoryId: 'gadget', amount: 21_500, payment: 'point_once' }] }))
      .toEqual({ income: 4_000_000, otherFixed: 917_000, card: 600_000 })
  })
})

describe('우리 집 수입(시작하기·이번 달 투자금와 같은 값)', () => {
  const stored = { household: 'dual-income', ownIncome: 3_000_000, partnerIncome: 2_000_000, ownPayday: 25, partnerPayday: 10 }
  const route = (userState: unknown) => (path: string, o?: { method?: string }) => {
    if (path === '/api/ui/user-state') return Promise.resolve(o?.method === 'POST' ? { ok: true } : { data: userState })
    if (path.startsWith('/api/ui/seed-builder')) return Promise.resolve(o?.method === 'PUT' ? { ok: true } : { data: [] })
    return Promise.resolve({ entries: [], rules: [], checks: [{ id: 'c1', date: '2026-09-30', label: '', input: savedInput }] })
  }

  it('저장된 맞벌이 수입을 사람별로 보여 주고, 이번 달 투자금에 반영할 때 나눈 그대로 보낸다', async () => {
    window.localStorage.clear()
    apiFetchMock.mockImplementation(route({ householdIncome: { value: stored, updatedAt: Date.now() } }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderCheck()
    await waitFor(() => expect((screen.getByLabelText('배우자 월 수입(세후)') as HTMLInputElement).value).toBe('2000000'))
    expect((screen.getByLabelText('본인 월 수입(세후)') as HTMLInputElement).value).toBe('3000000')
    // 5,000,000 − 현금 지출 1,517,000 − 비상자금 200,000
    expect(screen.getByLabelText('점검 결과')).toHaveTextContent('지금 투자 가능액(월)3,283,000원')
    fireEvent.click(screen.getByRole('button', { name: '이번 달 투자금 이번 달에 반영' }))
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ui/seed-builder', expect.objectContaining({ method: 'PUT' })))
    const body = JSON.parse(apiFetchMock.mock.calls.find(([p, o]) => p === '/api/ui/seed-builder' && o?.method === 'PUT')![1].body)
    expect(body).toMatchObject({ household: 'dual-income', ownIncome: 3_000_000, partnerIncome: 2_000_000, ownPayday: 25, partnerPayday: 10 })
  })

  it('저장값이 없으면 지난 점검 합계로 시작하고, 나눠 적으면 점검을 저장하지 않아도 우리 집 수입에 저장된다', async () => {
    window.localStorage.clear()
    apiFetchMock.mockImplementation(route({}))
    renderCheck()
    await waitFor(() => expect((screen.getByLabelText('월 수입(세후)') as HTMLInputElement).value).toBe('4000000'))
    fireEvent.click(screen.getByRole('button', { name: '맞벌이' }))
    fireEvent.change(screen.getByLabelText('본인 월 수입(세후)'), { target: { value: '2500000' } })
    fireEvent.change(screen.getByLabelText('배우자 월 수입(세후)'), { target: { value: '1500000' } })
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ui/user-state', expect.objectContaining({ method: 'POST' })), { timeout: 2000 })
    const posted = apiFetchMock.mock.calls.filter(([p, o]) => p === '/api/ui/user-state' && o?.method === 'POST').map(([, o]) => JSON.parse(o.body)).pop()
    expect(posted).toMatchObject({ key: 'householdIncome', value: { household: 'dual-income', ownIncome: 2_500_000, partnerIncome: 1_500_000 } })
    expect(apiFetchMock).not.toHaveBeenCalledWith('/api/ui/money-flow', expect.objectContaining({ method: 'POST' }))
  })
})

describe('고정지출은 기준, 기록은 실제', () => {
  it('기록으로 채워도 고정지출 기준은 그대로 두고 기록 금액을 옆에 보여 주며, 바꿀지는 직접 고른다', async () => {
    const input = { ...savedInput, fixed: [...savedInput.fixed, { categoryId: 'utilities', amount: 13_000, label: '전기·가스' }] }
    apiFetchMock.mockResolvedValue({
      rules: [], checks: [{ id: 'c1', date: '2026-09-30', label: '', input }],
      entries: [
        { id: 'a', date: `${month}-03`, amount: 12_400, memo: '전기요금', categoryId: 'utilities', cut: null, mustPart: null, payment: 'cash' },
        { id: 'b', date: `${month}-04`, amount: 55_000, memo: '휴대폰', categoryId: 'phone', cut: null, mustPart: null, payment: 'cash' },
        { id: 'c', date: `${month}-05`, amount: 30_000, memo: '배민', categoryId: 'delivery', cut: null, mustPart: null, payment: 'cash' },
      ],
    })
    renderCheck()
    // 채우기 전에도 기록 금액은 보인다
    expect(await screen.findByText(/기록 12,400원 \(기준보다 600원 적음\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /기록으로 채우기/ }))
    expect((screen.getByLabelText('전기·가스 월 금액') as HTMLInputElement).value).toBe('13000')
    // 없던 고정 분류는 더하고, 변동은 기록 금액으로 바꾼다
    expect((screen.getByLabelText('휴대폰 월 금액') as HTMLInputElement).value).toBe('55000')
    expect((screen.getByLabelText('배달 월 금액') as HTMLInputElement).value).toBe('30000')
    fireEvent.click(screen.getByRole('button', { name: '기록 금액으로 바꾸기' }))
    expect((screen.getByLabelText('전기·가스 월 금액') as HTMLInputElement).value).toBe('12400')
    expect(screen.queryByText(/기준보다 600원 적음/)).toBeNull()
  })
})

describe('월 합계와 점검', () => {
  it('합계를 적은 달로 채우면 세부와의 차액이 "세부 안 적음" 한 줄로 들어간다', async () => {
    apiFetchMock.mockResolvedValue({
      rules: [], checks: [],
      entries: [{ id: 'c', date: `${month}-05`, amount: 30_000, memo: '배민', categoryId: 'delivery', cut: null, mustPart: null, payment: 'cash' }],
      totals: [{ month, label: 'A카드', kind: 'cash', amount: 800_000, mine: true }],
    })
    renderCheck()
    fireEvent.click(await screen.findByRole('button', { name: /기록으로 채우기/ }))
    expect((screen.getByLabelText('배달 월 금액') as HTMLInputElement).value).toBe('30000')
    expect((screen.getByLabelText('세부 안 적음 월 금액') as HTMLInputElement).value).toBe('770000')
  })

  it('고정지출도 카드 합계 안에 있으니 빼고, 지난 변동 기준은 남기지 않아 두 번 세지 않는다', async () => {
    // 고정: 월세 900,000 + 넷플릭스 17,000(이 달 세부 기록 없음). 지난 변동 기준: 기본 식재료 400,000·배달 150,000
    apiFetchMock.mockResolvedValue({
      rules: [], checks: [{ id: 'c1', date: '2026-09-30', label: '', input: savedInput }],
      entries: [{ id: 'c', date: `${month}-05`, amount: 30_000, memo: '배민', categoryId: 'delivery', cut: null, mustPart: null, payment: 'cash' }],
      totals: [{ month, label: 'A카드', kind: 'cash', amount: 1_500_000, mine: true }],
    })
    renderCheck()
    fireEvent.click(await screen.findByRole('button', { name: /기록으로 채우기/ }))
    // 1,500,000 − 고정 917,000 − 세부 30,000 = 553,000
    expect((screen.getByLabelText('세부 안 적음 월 금액') as HTMLInputElement).value).toBe('553000')
    expect((screen.getByLabelText('배달 월 금액') as HTMLInputElement).value).toBe('30000')
    expect(screen.queryByLabelText('기본 식재료 월 금액')).toBeNull()
    expect((screen.getByLabelText('월세 월 금액') as HTMLInputElement).value).toBe('900000')
  })
})

describe('고정비 바뀐 기록', () => {
  it('저장한 점검이 둘 이상이면 고정비를 항목별로 나란히 보여 주고 지난번 대비 차이를 표시한다', async () => {
    const withUtilities = (amount: number) => ({ ...savedInput, fixed: [...savedInput.fixed, { categoryId: 'utilities', amount, label: '전기·가스' }] })
    apiFetchMock.mockResolvedValue({
      entries: [], rules: [],
      checks: [{ id: 'c2', date: '2026-09-30', label: '', input: withUtilities(90_000) }, { id: 'c1', date: '2026-08-31', label: '', input: withUtilities(123_000) }],
    })
    renderCheck()
    const table = await screen.findByLabelText('고정비 바뀐 기록')
    const row = [...table.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.startsWith('전기·가스'))!
    expect(row.textContent).toBe('전기·가스123,000원90,000원−33,000원')
  })
})

describe('비정기 1년 예산', () => {
  it('합계 달로 채워도 1년 예산은 덮지 않고, 이 달 예산 몫은 세부 안 적음에서 빼며, 연도별 실제를 보여 준다', async () => {
    const m = Number(month.slice(5))
    const input = { ...savedInput, irregular: [{ categoryId: 'tax', label: '재산세', yearlyAmount: 600_000, months: [m] }, { categoryId: 'car', label: '자동차보험', yearlyAmount: 900_000, months: [m] }] }
    const lastYear = String(Number(month.slice(0, 4)) - 1)
    apiFetchMock.mockResolvedValue({
      rules: [], checks: [{ id: 'c1', date: '2026-01-01', label: '', input }],
      entries: [
        { id: 'a', date: `${month}-05`, amount: 612_000, memo: '재산세', categoryId: 'tax', cut: null, mustPart: null, payment: 'cash' },
        { id: 'b', date: `${lastYear}-${month.slice(5)}-05`, amount: 590_000, memo: '재산세', categoryId: 'tax', cut: null, mustPart: null, payment: 'cash' },
      ],
      totals: [{ month, label: 'A카드', kind: 'cash', amount: 3_000_000, mine: true }],
    })
    renderCheck()
    fireEvent.click(await screen.findByRole('button', { name: /기록으로 채우기/ }))
    // 3,000,000 − 고정 917,000 − 세부(재산세 실제) 612,000 − 자동차보험 예산 몫 900,000 = 571,000
    expect((screen.getByLabelText('세부 안 적음 월 금액') as HTMLInputElement).value).toBe('571000')
    expect((screen.getByLabelText('재산세 1년 금액') as HTMLInputElement).value).toBe('600000')
    const row = [...screen.getByLabelText('비정기 실제 기록').querySelectorAll('tbody tr')].find((tr) => tr.textContent?.startsWith('재산세'))!
    expect(row.textContent).toBe('재산세600,000원590,000원612,000원예산 +12,000원')
  })
})

describe('현금·비상금과 점검', () => {
  it('현금 세부는 카드 차액에서 빼지 않고 따로 들어가며, 예산 밖 비정기는 1년 예산에 넣지 않고 비상금 안내만 한다', async () => {
    apiFetchMock.mockResolvedValue({
      rules: [], checks: [],
      entries: [
        { id: 'a', date: `${month}-05`, amount: 30_000, memo: '시장', categoryId: 'grocery_mart', cut: null, mustPart: null, payment: 'cash', paidWith: 'cash' },
        { id: 'b', date: `${month}-06`, amount: 100_000, memo: '축의금', categoryId: 'occasion', cut: null, mustPart: null, payment: 'cash', paidWith: 'cash' },
      ],
      totals: [{ month, label: 'A카드', kind: 'cash', amount: 800_000, mine: true }],
    })
    renderCheck()
    fireEvent.click(await screen.findByRole('button', { name: /기록으로 채우기/ }))
    // 카드 800,000은 세부가 없으니 전부 세부 안 적음, 현금 장보기는 따로
    expect((screen.getByLabelText('세부 안 적음 월 금액') as HTMLInputElement).value).toBe('800000')
    expect((screen.getByLabelText('장보기(마트) 월 금액') as HTMLInputElement).value).toBe('30000')
    expect(screen.queryByLabelText('경조사·명절 1년 금액')).toBeNull()
    expect(screen.getByText(/1년 예산에 없던 비정기 100,000원은 비상금에서 나간 돈/)).toBeTruthy()
  })
})
