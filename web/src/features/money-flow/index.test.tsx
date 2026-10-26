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

describe('지출 기록', () => {
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

  it('삼성 모니모 메일을 가맹점 / 금액 / 날짜 블록 그대로 붙여넣어도 읽어서 입력칸을 한 줄형으로 바꾼다', async () => {
    renderPage()
    const monimo = ['네이버페이 네이버', '42,120원', '', '26. 9. 25본 인 6163', '보너스P 421P', '', '컴포즈커피 방화역점', '4,600원', '', '26. 9. 25본 인 6163', '보너스P 46P'].join('\n')
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: monimo } })
    fireEvent.click(screen.getByRole('button', { name: '읽기' }))
    expect((screen.getByLabelText(/무엇을 얼마에/) as HTMLTextAreaElement).value).toBe(['2026-09-25 네이버페이 네이버 42,120원', '2026-09-25 컴포즈커피 방화역점 4,600원'].join('\n'))
    expect((screen.getByLabelText('네이버페이 네이버 날짜') as HTMLInputElement).value).toBe('2026-09-25')
    expect((screen.getByLabelText('네이버페이 네이버 금액') as HTMLInputElement).value).toBe('42120')
    expect(screen.getByText(/2줄을 읽었습니다/)).toBeTruthy()
  })

  it('현대카드 이용내역(이용 일자: · 가맹점 · 금액 · 결제구분…)을 붙여넣으면 필요한 줄만 읽고 총 건수도 맞춰 본다', async () => {
    renderPage()
    const hyundai = [
      '총 3건 총금액 6,560원', '', '--------------------', '',
      '이용 일자: 26. 10. 25', '씨유CU청량리스카이점', '4,560원', '결제구분: 일시불', '카드명: 네이버 현대카드', '적립 예정 45(1.0%)', '', '--------------------', '',
      '이용 일자: 26. 10. 18', '지파크', '1,000원', '결제구분: 일시불', '', '--------------------', '',
      '이용 일자: 26. 10. 18', '지파크', '1,000원', '결제구분: 일시불',
    ].join('\n')
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: hyundai } })
    fireEvent.click(screen.getByRole('button', { name: '읽기' }))
    expect((screen.getByLabelText(/무엇을 얼마에/) as HTMLTextAreaElement).value)
      .toBe(['2026-10-25 씨유CU청량리스카이점 4,560원', '2026-10-18 지파크 1,000원', '2026-10-18 지파크 1,000원'].join('\n'))
    expect((screen.getByLabelText('씨유CU청량리스카이점 날짜') as HTMLInputElement).value).toBe('2026-10-25')
    expect(screen.getByText(/3줄을 읽었습니다/)).toBeTruthy()
    expect(screen.queryByText(/적혀 있는데/)).toBeNull()
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

  it('네이버페이·쿠팡처럼 통로 이름만 있으면 묻지 않고 온라인 쇼핑, 산 물건은 선택으로 적으면 다시 분류한다', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: '네이버페이 32000원' } })
    fireEvent.click(screen.getByRole('button', { name: '읽기' }))
    expect(screen.getByText(/뭘 샀는지 알면 적어 주세요\(선택\)/)).toBeTruthy()
    expect(screen.queryByText('어디에 넣을까요?')).toBeNull()
    expect((screen.getByLabelText('네이버페이 분류') as HTMLSelectElement).value).toBe('online_shop')
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
    expect(screen.getByText(/묻지 않은 줄 1건/)).toBeTruthy()
    expect(screen.queryByText('어디에 넣을까요?')).toBeNull()
    expect(screen.queryByText(/뭘 샀는지 알면/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '3건 저장' }))
    await waitFor(() => expect(postBodies()).toHaveLength(1))
    expect(postBodies()[0].entries.map((e: any) => [e.memo, e.categoryId, e.learn])).toEqual([['맥모닝콤보', 'eat_out', false], ['동네 분식', 'etc', false], ['쿠팡', 'online_shop', false]])
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
    fireEvent.click(screen.getByLabelText('배민 지우기'))
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
    expect(await screen.findByText('공용 40,000원 · 나 55,000원 · 배우자 39,000원')).toBeTruthy()
    expect(screen.getByText('돌려받은 돈: 공용 0원 · 나 0원 · 배우자 23,000원')).toBeTruthy()
  })
})

describe('월 합계 칸', () => {
  const month = today.slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)

  it('새 달은 지난달 칸 이름을 이어받고, 적은 칸만 저장하며 세부와의 차액을 보여 준다', async () => {
    apiFetchMock.mockImplementation((_path: string, options?: { method?: string }) => options?.method === 'POST' ? Promise.resolve({ ok: true }) : Promise.resolve({
      entries: [{ id: 'a', date: `${month}-02`, amount: 50_000, memo: '배민', categoryId: 'delivery', cut: null, mustPart: null, payment: 'cash' }],
      rules: [], checks: [],
      totals: [{ month: prev, label: 'A카드', kind: 'cash', amount: 900_000, mine: true }, { month: prev, label: '포인트', kind: 'point', amount: 10_000, mine: true }],
    }))
    renderPage()
    await screen.findByText('배민')
    expect((screen.getByLabelText('1번 칸 이름') as HTMLInputElement).value).toBe('A카드')
    expect((screen.getByLabelText('A카드 금액') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('A카드 금액'), { target: { value: '1200000' } })
    const facts = screen.getByLabelText('합계와 세부 기록')
    expect(facts.textContent).toContain('세부 안 적음1,150,000원')
    fireEvent.click(screen.getByRole('button', { name: '합계 저장' }))
    await waitFor(() => expect(postBodies()).toHaveLength(1))
    // 금액을 비워 둔 포인트 칸은 보내지 않는다
    expect(postBodies()[0]).toEqual({ action: 'save-month-totals', month, totals: [{ label: 'A카드', kind: 'cash', amount: 1_200_000 }] })
  })

  it('다음 달로 넘어가 결제 예정금액을 미리 적고, 그 뒤 달로는 못 넘어간다. 카드 세부가 없으면 세부 안 적음을 숨긴다', async () => {
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
    apiFetchMock.mockImplementation((_path: string, options?: { method?: string }) => options?.method === 'POST' ? Promise.resolve({ ok: true }) : Promise.resolve({
      entries: [], rules: [], checks: [],
      totals: [{ month, label: 'A카드', kind: 'cash', amount: 900_000, mine: true, updatedAt: `${month}-03T01:00:00Z` }],
    }))
    renderPage()
    await screen.findByText(`${month.replace('-', '년 ')}월 합계`)
    expect(screen.getByLabelText('합계와 세부 기록').textContent).not.toContain('세부 안 적음')
    fireEvent.click(screen.getByRole('button', { name: '다음 달' }))
    await screen.findByText(`${next.replace('-', '년 ')}월 결제 예정`)
    expect((screen.getByRole('button', { name: '다음 달' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/다음 결제 예정금액/)).toBeTruthy()
    fireEvent.change(await screen.findByLabelText('A카드 금액'), { target: { value: '400000' } })
    fireEvent.click(screen.getByRole('button', { name: '합계 저장' }))
    await waitFor(() => expect(postBodies()).toHaveLength(1))
    expect(postBodies()[0]).toEqual({ action: 'save-month-totals', month: next, totals: [{ label: 'A카드', kind: 'cash', amount: 400_000 }] })
  })

  it('겹치는 칸 이름은 저장 전에 막는다', async () => {
    renderPage()
    await screen.findByText('아직 기록이 없습니다.')
    // 기본 칸은 '카드' 하나 — 칸을 더해 같은 이름을 붙인다
    fireEvent.click(screen.getByRole('button', { name: '칸 추가' }))
    fireEvent.change(screen.getByLabelText('2번 칸 이름'), { target: { value: '카드' } })
    const [first, second] = screen.getAllByLabelText('카드 금액')
    fireEvent.change(first, { target: { value: '1000' } })
    fireEvent.change(second, { target: { value: '2000' } })
    fireEvent.click(screen.getByRole('button', { name: '합계 저장' }))
    expect(screen.getByText(/칸 이름이 겹칩니다/)).toBeTruthy()
    expect(postBodies()).toHaveLength(0)
  })

  it('합계 테이블이 아직 없으면 합계 칸만 끄고 세부 기록은 그대로 쓴다', async () => {
    apiFetchMock.mockResolvedValue({ entries: [], rules: [], checks: [], totals: [], totalsReady: false })
    renderPage()
    expect(await screen.findByText(/합계 칸은 준비 중입니다/)).toBeTruthy()
    expect(screen.getByLabelText(/무엇을 얼마에/)).toBeTruthy()
  })

  it('이번 달 보기: 합계 기준 현금 지출, 세부 안 적음, 6개월 추이', async () => {
    apiFetchMock.mockResolvedValue({
      entries: [
        { id: 'a', date: `${month}-02`, amount: 50_000, memo: '배민', categoryId: 'delivery', cut: null, mustPart: null, payment: 'cash' },
        { id: 'b', date: `${prev}-02`, amount: 70_000, memo: '배민', categoryId: 'delivery', cut: null, mustPart: null, payment: 'cash' },
      ],
      rules: [], checks: [],
      totals: [{ month, label: 'A카드', kind: 'cash', amount: 1_000_000, mine: true }],
    })
    renderPage()
    await screen.findAllByText('배민')
    expect(screen.getByText('현금 지출').nextElementSibling?.textContent).toBe('1,000,000원')
    expect(screen.getAllByText('세부 안 적음')[0].nextElementSibling?.textContent).toBe('950,000원')
    expect(screen.getByLabelText('줄일 수 있나').textContent).toContain('모름(세부 안 적음)950,000원')
    const trend = screen.getByLabelText('최근 6개월 지출 추이')
    expect(trend.textContent).toContain('1,000,000원')
    // 합계를 안 적은 지난달은 세부 합으로 표시
    expect(trend.textContent).toContain('70,000원세부 합')
  })
})

describe('지출 추이', () => {
  it('합계를 적은 달은 카드 합계 − 고정비 − 그 달 비정기 = 나머지(변동)와 전달 대비 증감을 보여 준다', async () => {
    const month = today.slice(0, 7)
    const [y, m] = month.split('-').map(Number)
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
    const input = { monthlyIncome: 0, reserveMonthly: 0, variable: [], fixed: [{ categoryId: 'maintenance', amount: 900_000, label: '' }], irregular: [{ categoryId: 'tax', label: '자동차세', yearlyAmount: 300_000, months: [m] }] }
    apiFetchMock.mockResolvedValue({
      entries: [], rules: [],
      checks: [{ id: 'c1', date: `${prev}-01`, label: '', input }],
      totals: [{ month: prev, label: 'A카드', kind: 'cash', amount: 1_700_000, mine: true }, { month, label: 'A카드', kind: 'cash', amount: 1_500_000, mine: true }],
    })
    renderPage()
    await screen.findByText(/합계\b|월 합계/)
    const rows = [...screen.getByLabelText('최근 6개월 지출 추이').querySelectorAll('tbody tr')].map((tr) => tr.textContent)
    expect(rows).toEqual([
      // 투자 가능 = 수입 0 − 고정 900,000 − 변동 − 비정기 적립 25,000 − 비상금 0
      `${Number(prev.slice(5))}월1,700,000원1,700,000원900,000원—800,000원-1,725,000원`,
      // 이번 달에 나간 자동차세 30만 원은 나머지(변동)에서 뺀다
      `${Number(month.slice(5))}월1,500,000원1,500,000원900,000원300,000원300,000원▼500,000원-1,225,000원`,
    ])
  })
})

describe('이번 달 나가는 비정기', () => {
  const month = today.slice(0, 7)
  const m = Number(month.slice(5))
  const plan = { monthlyIncome: 0, reserveMonthly: 0, variable: [], fixed: [{ categoryId: 'maintenance', amount: 300_000, label: '' }],
    irregular: [{ categoryId: 'tax', label: '재산세', yearlyAmount: 600_000, months: [m] }, { categoryId: 'car', label: '자동차보험', yearlyAmount: 900_000, months: [m === 12 ? 1 : m + 1] }] }
  const mock = (entries: unknown[]) => apiFetchMock.mockImplementation((_path: string, options?: { method?: string }) => options?.method === 'POST' ? Promise.resolve({ ok: true }) : Promise.resolve({
    entries, rules: [], checks: [{ id: 'c1', date: `${month}-01`, label: '', input: plan }],
    totals: [{ month, label: 'A카드', kind: 'cash', amount: 1_500_000, mine: true }],
  }))

  it('이 달 몫만 예상과 함께 보여 주고, 실제를 적으면 그 이름으로 세부 기록에 더하며 나머지(변동)를 계산한다', async () => {
    mock([])
    renderPage()
    const input = await screen.findByLabelText('재산세 실제')
    expect(screen.queryByLabelText('자동차보험 실제')).toBeNull()
    expect(screen.getByText('예상 600,000원')).toBeTruthy()
    const facts = screen.getByLabelText('합계와 세부 기록')
    // 1,500,000 − 고정 300,000 − 비정기(예상) 600,000
    expect(facts.textContent).toContain('나머지(변동)600,000원')
    fireEvent.change(input, { target: { value: '612000' } })
    expect(facts.textContent).toContain('나머지(변동)588,000원')
    fireEvent.click(screen.getByRole('button', { name: '합계 저장' }))
    await waitFor(() => expect(postBodies().some((b) => b.action === 'add-entries')).toBe(true))
    expect(postBodies().find((b) => b.action === 'add-entries').entries).toEqual([{ date: today, amount: 612_000, memo: '재산세', categoryId: 'tax', payment: 'cash', forWhom: 'shared', learn: false }])
  })

  it('이미 실제 기록이 있으면 금액만 고친다', async () => {
    mock([{ id: 'e1', date: `${month}-02`, amount: 610_000, memo: '재산세', categoryId: 'tax', cut: null, mustPart: null, payment: 'cash' }])
    renderPage()
    const input = await screen.findByLabelText('재산세 실제') as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('610000'))
    fireEvent.change(input, { target: { value: '612000' } })
    fireEvent.click(screen.getByRole('button', { name: '합계 저장' }))
    await waitFor(() => expect(postBodies().some((b) => b.action === 'update-entry')).toBe(true))
    expect(postBodies().find((b) => b.action === 'update-entry')).toMatchObject({ id: 'e1', amount: 612_000, memo: '재산세', date: `${month}-02` })
    expect(postBodies().some((b) => b.action === 'add-entries')).toBe(false)
  })

  it('아래 빠른 기록에 타이핑해도 저장 전 합계 입력이 지워지지 않는다', async () => {
    mock([])
    renderPage()
    const a = await screen.findByLabelText('A카드 금액') as HTMLInputElement
    await waitFor(() => expect(a.value).toBe('1500000'))
    fireEvent.change(a, { target: { value: '1600000' } })
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: '우유 3000원' } })
    expect((screen.getByLabelText('A카드 금액') as HTMLInputElement).value).toBe('1600000')
  })
})

describe('현금으로 낸 돈', () => {
  const month = today.slice(0, 7)

  it('메모에 "현금"이 있으면 현금으로 표시해 저장하고, 고칠 때도 현금 표시를 유지한다', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/무엇을 얼마에/), { target: { value: '축의금 100000원 현금\n망원시장 서울페이 23000원' } })
    fireEvent.click(screen.getByRole('button', { name: '읽기' }))
    const checks = screen.getAllByRole('checkbox', { name: '현금으로 냄' }) as HTMLInputElement[]
    expect(checks.map((c) => c.checked)).toEqual([true, true])
    fireEvent.click(screen.getByRole('button', { name: '2건 저장' }))
    await waitFor(() => expect(postBodies()).toHaveLength(1))
    expect(postBodies()[0].entries.map((e: any) => [e.memo, e.categoryId, e.paidWith])).toEqual([['축의금', 'occasion', 'cash'], ['망원시장 서울페이', expect.any(String), 'cash']])
  })

  it('카드 합계에 현금 세부를 더하고, 1년 예산에 없던 비정기는 비상금에서 나간 돈으로 따로 보여 준다', async () => {
    const plan = { monthlyIncome: 0, reserveMonthly: 0, variable: [], irregular: [], fixed: [{ categoryId: 'maintenance', amount: 300_000, label: '' }] }
    apiFetchMock.mockImplementation((_path: string, options?: { method?: string }) => options?.method === 'POST' ? Promise.resolve({ ok: true }) : Promise.resolve({
      entries: [
        { id: 'a', date: `${month}-02`, amount: 100_000, memo: '축의금', categoryId: 'occasion', cut: null, mustPart: null, payment: 'cash', paidWith: 'cash' },
        { id: 'b', date: `${month}-03`, amount: 20_000, memo: '시장', categoryId: 'grocery_mart', cut: null, mustPart: null, payment: 'cash', paidWith: 'cash' },
        { id: 'c', date: `${month}-04`, amount: 30_000, memo: '배민', categoryId: 'delivery', cut: null, mustPart: null, payment: 'cash' },
      ],
      rules: [], checks: [{ id: 'c1', date: `${month}-01`, label: '', input: plan }],
      totals: [{ month, label: 'A카드', kind: 'cash', amount: 1_000_000, mine: true }],
    }))
    renderPage()
    const facts = await screen.findByLabelText('합계와 세부 기록')
    await waitFor(() => expect(facts.textContent).toContain('현금으로 낸 돈120,000원 (2건)'))
    // 카드 1,000,000(배민은 그 안의 세부) + 현금 120,000
    expect(facts.textContent).toContain('이 달 지출1,120,000원')
    expect(facts.textContent).toContain('세부 안 적음970,000원')
    // 나머지(변동) = 1,120,000 − 고정 300,000 − 비정기(예산 밖 축의금 100,000)
    expect(facts.textContent).toContain('나머지(변동)720,000원')
    expect(screen.getByText(/1년 예산에 없던 비정기 100,000원은 비상금에서 나간 돈/)).toBeTruthy()
    expect(screen.getByText('비상금에서 나간 돈').nextElementSibling?.textContent).toBe('100,000원')
    expect(screen.getByText('현금 지출').nextElementSibling?.textContent).toBe('1,120,000원')
  })
})

describe('지출 추이 카드별 칸', () => {
  it('카드 이름별 칸과 현금 칸을 달마다 나란히 보여 준다', async () => {
    const month = today.slice(0, 7)
    const [y, m] = month.split('-').map(Number)
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
    apiFetchMock.mockResolvedValue({
      entries: [{ id: 'a', date: `${month}-02`, amount: 50_000, memo: '시장', categoryId: 'grocery_mart', cut: null, mustPart: null, payment: 'cash', paidWith: 'cash' }],
      rules: [], checks: [],
      totals: [
        { month: prev, label: 'A카드', kind: 'cash', amount: 1_000_000, mine: true },
        { month, label: 'A카드', kind: 'cash', amount: 1_100_000, mine: true }, { month, label: 'B카드', kind: 'cash', amount: 200_000, mine: true },
      ],
    })
    renderPage()
    await screen.findByText('시장')
    const table = screen.getByLabelText('최근 6개월 지출 추이')
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['달', 'A카드', 'B카드', '현금', '지출 합계', '고정비', '비정기', '나머지(변동)', '투자 가능'])
    expect([...table.querySelectorAll('tbody tr')].map((tr) => tr.textContent)).toEqual([
      `${Number(prev.slice(5))}월1,000,000원——1,000,000원————`,
      `${Number(month.slice(5))}월1,100,000원200,000원50,000원1,350,000원————`,
    ])
  })
})
