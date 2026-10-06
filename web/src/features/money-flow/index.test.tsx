import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MoneyFlowPage from './index'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

beforeEach(() => {
  apiFetchMock.mockReset()
  apiFetchMock.mockImplementation((_path: string, options?: { method?: string }) =>
    options?.method === 'POST' ? Promise.resolve({ ok: true, data: [] }) : Promise.resolve({ entries: [], rules: [], checks: [] }))
})

const renderPage = () => render(<MemoryRouter><MoneyFlowPage /></MemoryRouter>)
const postBodies = () => apiFetchMock.mock.calls.filter(([, o]) => o?.method === 'POST').map(([, o]) => JSON.parse(o.body))

describe('돈 흐름', () => {
  it('여러 줄을 읽어 자동 분류하고, 금액 없는 줄은 알려 준다', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: '냉동피자 4판 15170\n곰곰 우유 900ml 2개 3690\n메모만' } })
    fireEvent.click(screen.getByRole('button', { name: '읽기' }))
    expect((screen.getByLabelText('냉동피자 4판 금액') as HTMLInputElement).value).toBe('15170')
    expect((screen.getByLabelText('냉동피자 4판 분류') as HTMLSelectElement).value).toBe('grocery_ready')
    expect((screen.getByLabelText('곰곰 우유 900ml 2개 분류') as HTMLSelectElement).value).toBe('grocery_basic')
    expect(screen.getByText(/금액을 못 찾은 줄: 메모만/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '2건 저장' }))
    await waitFor(() => expect(postBodies()).toHaveLength(1))
    const body = postBodies()[0]
    expect(body.action).toBe('add-entries')
    expect(body.entries.map((e: any) => [e.date, e.amount, e.categoryId, e.learn])).toEqual([[today, 15170, 'grocery_ready', false], [today, 3690, 'grocery_basic', false]])
  })

  it('줄 앞 날짜(261001)는 그 줄의 날짜가 되고, 금액·날짜를 저장 전에 고칠 수 있다', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: '261001 카스 디지털 체중계 X15 21500원\n우유 2 3690' } })
    fireEvent.click(screen.getByRole('button', { name: '읽기' }))
    expect((screen.getByLabelText('카스 디지털 체중계 X15 날짜') as HTMLInputElement).value).toBe('2026-10-01')
    expect((screen.getByLabelText('카스 디지털 체중계 X15 금액') as HTMLInputElement).value).toBe('21500')
    expect((screen.getByLabelText('우유 2 날짜') as HTMLInputElement).value).toBe(today)
    // "원" 없이 숫자가 여럿이면 금액 확인 표시
    expect(screen.getByText('금액 확인')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('우유 2 금액'), { target: { value: '3000' } })
    expect(screen.queryByText('금액 확인')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '2건 저장' }))
    await waitFor(() => expect(postBodies()).toHaveLength(1))
    expect(postBodies()[0].entries.map((e: any) => [e.date, e.amount])).toEqual([['2026-10-01', 21500], [today, 3000]])
  })

  it('모르는 메모는 제안 버튼으로 고르고, 고른 분류를 학습하도록 보낸다', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: '피자 2만원' } })
    fireEvent.click(screen.getByRole('button', { name: '읽기' }))
    expect(screen.getByText('어디에 넣을까요?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '외식' }))
    fireEvent.change(screen.getByLabelText('피자 결제 수단'), { target: { value: 'point_once' } })
    fireEvent.click(screen.getByRole('button', { name: '1건 저장' }))
    await waitFor(() => expect(postBodies()).toHaveLength(1))
    expect(postBodies()[0].entries[0]).toMatchObject({ amount: 20000, memo: '피자', categoryId: 'eat_out', payment: 'point_once', learn: true })
  })

  it('고친 기록이 있으면 그 분류를 먼저 쓴다', async () => {
    apiFetchMock.mockResolvedValue({ entries: [], rules: [{ keyword: '피자', categoryId: 'grocery_ready' }], checks: [] })
    renderPage()
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled())
    await screen.findByText('아직 기록이 없습니다.')
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: '도미노 피자 25000' } })
    fireEvent.click(screen.getByRole('button', { name: '읽기' }))
    expect((screen.getByLabelText('도미노 피자 분류') as HTMLSelectElement).value).toBe('grocery_ready')
    expect(screen.queryByText('어디에 넣을까요?')).toBeNull()
  })

  it('이번 달 보기: 현금 지출과 포인트를 나누고 줄일 수 있나로 합친다', async () => {
    const month = today.slice(0, 7)
    apiFetchMock.mockResolvedValue({
      entries: [
        { id: 'a', date: `${month}-01`, amount: 15170, memo: '냉동피자', categoryId: 'grocery_ready', cut: null, mustPart: null, payment: 'cash' },
        { id: 'b', date: `${month}-01`, amount: 3690, memo: '우유', categoryId: 'grocery_basic', cut: null, mustPart: null, payment: 'cash' },
        { id: 'c', date: `${month}-01`, amount: 21500, memo: '체중계', categoryId: 'gadget', cut: null, mustPart: null, payment: 'point_once' },
      ],
      rules: [], checks: [],
    })
    renderPage()
    await screen.findByText('냉동피자')
    fireEvent.click(screen.getByRole('tab', { name: '이번 달 보기' }))
    expect(screen.getByText('현금 지출').nextElementSibling?.textContent).toBe('18,860원')
    expect(screen.getByText('생활 소비(포인트 포함)').nextElementSibling?.textContent).toBe('40,360원')
    expect(screen.getByText(/이번만 포인트 21,500원/)).toBeTruthy()
    const cut = screen.getByLabelText('줄일 수 있나')
    expect(cut.textContent).toContain('못 줄임3,690원')
    expect(cut.textContent).toContain('줄일 수 있음15,170원')
  })

  it('건너뛴 달이 있어도 마지막으로 기록한 달과 비교한다', async () => {
    const month = today.slice(0, 7)
    const [y, m] = month.split('-').map(Number)
    const threeAgo = new Date(Date.UTC(y, m - 4, 1)).toISOString().slice(0, 7)
    apiFetchMock.mockResolvedValue({
      entries: [
        { id: 'a', date: `${month}-01`, amount: 50000, memo: '배민', categoryId: 'delivery', cut: null, mustPart: null, payment: 'cash' },
        { id: 'b', date: `${threeAgo}-10`, amount: 20000, memo: '배민', categoryId: 'delivery', cut: null, mustPart: null, payment: 'cash' },
      ],
      rules: [], checks: [],
    })
    renderPage()
    await screen.findAllByText('배민')
    fireEvent.click(screen.getByRole('tab', { name: '이번 달 보기' }))
    expect(screen.getByText(`${threeAgo.slice(0, 4)}년 ${Number(threeAgo.slice(5))}월 기록보다`)).toBeTruthy()
    expect(screen.getByText('+30,000원')).toBeTruthy()
    expect(apiFetchMock.mock.calls[0][0]).toContain('from=')
  })

  it('배우자가 지출을 공유하면 우리 집 합계로 보이고, 배우자 기록은 고치거나 지울 수 없다', async () => {
    const month = today.slice(0, 7)
    apiFetchMock.mockResolvedValue({
      partnerShared: true, rules: [], checks: [],
      entries: [
        { id: 'a', mine: true, date: `${month}-02`, amount: 10000, memo: '우유', categoryId: 'grocery_basic', cut: null, mustPart: null, payment: 'cash' },
        { id: 'b', mine: false, date: `${month}-01`, amount: 30000, memo: '배민', categoryId: 'delivery', cut: null, mustPart: null, payment: 'cash' },
      ],
    })
    renderPage()
    expect(await screen.findByText(/기록 2건/)).toBeTruthy()
    expect(screen.getByText('배우자')).toBeTruthy()
    expect(screen.queryByLabelText('배민 삭제')).toBeNull()
    expect(screen.getByLabelText('우유 삭제')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '나만' }))
    expect(screen.getByText(/기록 1건/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '우리 집 합계' }))
    fireEvent.click(screen.getByRole('tab', { name: '이번 달 보기' }))
    expect(screen.getByText('현금 지출').nextElementSibling?.textContent).toBe('40,000원')
  })
})
