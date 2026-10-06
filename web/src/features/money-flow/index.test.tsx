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

  it('네이버페이·쿠팡처럼 통로 이름만 있으면 산 물건을 묻고, 적으면 다시 분류한다', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: '네이버페이 32000원' } })
    fireEvent.click(screen.getByRole('button', { name: '읽기' }))
    expect(screen.getByText(/뭘 샀나요\?/)).toBeTruthy()
    // 물건을 적기 전에는 분류 버튼을 띄우지 않는다
    expect(screen.queryByText('어디에 넣을까요?')).toBeNull()
    fireEvent.change(screen.getByLabelText('네이버페이 산 물건'), { target: { value: '물티슈' } })
    expect((screen.getByLabelText('네이버페이 분류') as HTMLSelectElement).value).toBe('hygiene')
    fireEvent.click(screen.getByRole('button', { name: '1건 저장' }))
    await waitFor(() => expect(postBodies()).toHaveLength(1))
    expect(postBodies()[0].entries[0]).toMatchObject({ memo: '네이버페이 물티슈', categoryId: 'hygiene', learn: false })
  })

  it('1만 원 미만인데 분류를 모르면 묻지 않고 접어 두며, 학습하지 않는다', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: '맥모닝콤보 3500원\n동네 분식 4000원\n쿠팡 5000원' } })
    fireEvent.click(screen.getByRole('button', { name: '읽기' }))
    expect(screen.getByText(/묻지 않은 줄 2건/)).toBeTruthy()
    expect(screen.queryByText('어디에 넣을까요?')).toBeNull()
    expect(screen.queryByText(/뭘 샀나요\?/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '3건 저장' }))
    await waitFor(() => expect(postBodies()).toHaveLength(1))
    expect(postBodies()[0].entries.map((e: any) => [e.memo, e.categoryId, e.learn])).toEqual([['맥모닝콤보', 'eat_out', false], ['동네 분식', 'etc', false], ['쿠팡', 'etc', false]])
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
    expect(screen.getByText(/이번만 들어온 21,500원/)).toBeTruthy()
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

  it('배우자가 지출을 공유하면 우리 집 합계로 보이고, 서로 고치거나 지울 수 있으며 누가 했는지 보인다', async () => {
    const month = today.slice(0, 7)
    apiFetchMock.mockImplementation((_p: string, o?: { method?: string }) => Promise.resolve(o?.method === 'POST' ? { ok: true } : {
      partnerShared: true, rules: [], checks: [],
      entries: [
        { id: 'a', mine: true, editedBy: 'partner', date: `${month}-02`, amount: 10000, memo: '우유', categoryId: 'grocery_basic', cut: null, mustPart: null, payment: 'cash' },
        { id: 'b', mine: false, forWhom: 'partner', editedBy: null, date: `${month}-01`, amount: 30000, memo: '배민', categoryId: 'delivery', cut: null, mustPart: null, payment: 'cash' },
      ],
      deleted: [
        { id: 'c', mine: false, deletedBy: 'me', date: `${month}-01`, amount: 5000, memo: '편의점', categoryId: 'convenience', cut: null, mustPart: null, payment: 'cash' },
      ],
    }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    expect(await screen.findByText(/기록 2건/)).toBeTruthy()
    expect(screen.getByText('배우자 것', { selector: 'em' })).toBeTruthy()
    expect(screen.getByText('배우자가 고침')).toBeTruthy()
    // 배우자 기록도 지울 수 있다
    fireEvent.click(screen.getByLabelText('배민 삭제'))
    await waitFor(() => expect(postBodies()).toContainEqual({ action: 'delete-entry', id: 'b' }))
    // 지운 기록은 되돌릴 수 있다
    expect(screen.getByText('지운 기록 1건')).toBeTruthy()
    expect(screen.getByText('내가 지움')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('편의점 되돌리기'))
    await waitFor(() => expect(postBodies()).toContainEqual({ action: 'restore-entry', id: 'c' }))
    // 목록은 읽기 전용 — '고치기'를 눌러야 그 줄만 고칠 칸이 열린다
    expect(screen.queryByLabelText('배민 금액 고치기')).toBeNull()
    fireEvent.click(screen.getByLabelText('배민 고치기'))
    expect(screen.queryByLabelText('우유 금액 고치기')).toBeNull()
    fireEvent.change(screen.getByLabelText('배민 금액 고치기'), { target: { value: '25000' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(postBodies().some((b) => b.action === 'update-entry' && b.id === 'b' && b.amount === 25000 && b.forWhom === 'partner' && b.learn === false)).toBe(true))
    await waitFor(() => expect(screen.queryByLabelText('배민 금액 고치기')).toBeNull())
  })

  it('배우자 것 빼고를 고르면 배우자 것만 합계에서 빠지고 공용은 남는다', async () => {
    const month = today.slice(0, 7)
    apiFetchMock.mockResolvedValue({
      partnerShared: true, rules: [], checks: [], deleted: [],
      entries: [
        { id: 'a', mine: true, date: `${month}-02`, amount: 10000, memo: '우유', categoryId: 'grocery_basic', cut: null, mustPart: null, payment: 'cash' },
        { id: 'b', mine: false, forWhom: 'partner', date: `${month}-01`, amount: 30000, memo: '배민', categoryId: 'delivery', cut: null, mustPart: null, payment: 'cash' },
        { id: 'c', mine: false, forWhom: 'shared', date: `${month}-01`, amount: 20000, memo: '장보기', categoryId: 'grocery_basic', cut: null, mustPart: null, payment: 'cash' },
      ],
    })
    renderPage()
    expect(await screen.findByText(/기록 3건/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '배우자 것 빼고' }))
    expect(screen.getByText(/기록 2건/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '우리 집 합계' }))
    fireEvent.click(screen.getByRole('tab', { name: '이번 달 보기' }))
    expect(screen.getByText('현금 지출').nextElementSibling?.textContent).toBe('60,000원')
  })
})

describe('돌려받은 돈', () => {
  it('"모두의카드 환급"은 대중교통의 매달 환급으로 읽고 그대로 저장한다', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: '모두의카드 환급 23000원' } })
    fireEvent.click(screen.getByRole('button', { name: '읽기' }))
    expect((screen.getByLabelText('모두의카드 환급 분류') as HTMLSelectElement).value).toBe('transit')
    expect((screen.getByLabelText('모두의카드 환급 결제 수단') as HTMLSelectElement).value).toBe('refund_regular')
    expect(screen.getByText(/돌려받은 돈 · 대중교통 지출에서 빼고/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '1건 저장' }))
    await waitFor(() => expect(postBodies()).toHaveLength(1))
    expect(postBodies()[0].entries[0]).toMatchObject({ amount: 23000, categoryId: 'transit', payment: 'refund_regular' })
  })
})

describe('누구 몫', () => {
  it('따로 적지 않으면 공용, "배우자"가 앞에 있든 중간에 있든 배우자 것으로 읽고 메모에서는 빼고 분류한다', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: '배우자 모두의 카드 환급 23000원\n모두의 카드 배우자 환급 23000원\n배우자 교통카드 62000원\n교통카드 55000원' } })
    fireEvent.click(screen.getByRole('button', { name: '읽기' }))
    const forWhom = screen.getAllByLabelText('모두의 카드 환급 누구 몫') as HTMLSelectElement[]
    expect(forWhom.map((s) => s.value)).toEqual(['partner', 'partner'])
    expect((screen.getAllByLabelText('모두의 카드 환급 결제 수단') as HTMLSelectElement[]).map((s) => s.value)).toEqual(['refund_regular', 'refund_regular'])
    expect((screen.getAllByLabelText('교통카드 누구 몫') as HTMLSelectElement[]).map((s) => s.value)).toEqual(['partner', 'shared'])
    fireEvent.click(screen.getByRole('button', { name: '4건 저장' }))
    await waitFor(() => expect(postBodies()).toHaveLength(1))
    expect(postBodies()[0].entries.map((e: any) => [e.memo, e.categoryId, e.payment, e.forWhom])).toEqual([
      ['모두의 카드 환급', 'transit', 'refund_regular', 'partner'],
      ['모두의 카드 환급', 'transit', 'refund_regular', 'partner'],
      ['교통카드', 'transit', 'cash', 'partner'],
      ['교통카드', 'transit', 'cash', 'shared'],
    ])
  })

  it('이번 달 보기에서 누구 몫 현금과 돌려받은 돈을 나눠 보여 준다', async () => {
    const month = today.slice(0, 7)
    const e = (id: string, amount: number, payment: string, forWhom: string) => ({ id, mine: true, forWhom, date: `${month}-01`, amount, memo: '교통카드', categoryId: 'transit', cut: null, mustPart: null, payment })
    apiFetchMock.mockImplementation(() => Promise.resolve({ rules: [], checks: [], entries: [e('s', 40000, 'cash', 'shared'), e('a', 55000, 'cash', 'me'), e('b', 62000, 'cash', 'partner'), e('c', 23000, 'refund_regular', 'partner')] }))
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: '이번 달 보기' }))
    expect(await screen.findByText('공용 40,000원 · 나 55,000원 · 배우자 39,000원')).toBeTruthy()
    expect(screen.getByText('돌려받은 돈: 공용 0원 · 나 0원 · 배우자 23,000원')).toBeTruthy()
  })
})
