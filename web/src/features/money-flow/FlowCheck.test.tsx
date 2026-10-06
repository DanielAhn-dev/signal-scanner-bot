import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MoneyFlowPage from './index'
import { rowsFromEntries } from './FlowCheck'
import { wizardFromCheck } from '../start-wizard'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({ useCurrentClientId: () => 'test-user' }))

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

describe('지금 상태 점검', () => {
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
