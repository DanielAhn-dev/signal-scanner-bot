import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccumulatePage from './index'
import { userScopedKey } from '../../lib/userState'

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
const planMock = vi.hoisted(() => ({ monthly: 0, mix: null as unknown }))
vi.mock('../my-plan/MyPlanCard', async () => {
  const { useEffect } = await import('react')
  return {
    default: ({ onPlanMonthly, onPlanMix }: { onPlanMonthly?: (m: number) => void; onPlanMix?: (mix: any) => void }) => {
      useEffect(() => { if (planMock.monthly) onPlanMonthly?.(planMock.monthly) }, [onPlanMonthly])
      useEffect(() => { if (planMock.mix) onPlanMix?.(planMock.mix) }, [onPlanMix])
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
  planMock.mix = null
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
  it('모든 시작 시점 그래프에 실제 한 사람 경로와 매끈한 선 안내', async () => {
    renderPage()
    await screen.findByText('추천')
    expect(screen.getByText(/실제 한 사람\(\d{4}-\d{2} 시작\)/)).toBeInTheDocument()
    expect(screen.getByText(/순위값을 이은 것이라 실제보다 매끈합니다/)).toBeInTheDocument()
  })

  it('나스닥100 상품을 고르면 그 지수 이력으로 계산하고 한계를 알린다', async () => {
    localStorage.setItem(userScopedKey('state:accumulate')!, JSON.stringify({ value: { target: { code: '133690', name: 'TIGER 미국나스닥100' } }, updatedAt: Date.now() }))
    renderPage()
    expect(await screen.findByText(/미국 기술주가 유난히 강했던 구간/)).toBeInTheDocument()
    expect(screen.queryByText(/코스피200 장기 이력으로 계산하므로 참고용/)).not.toBeInTheDocument()
    expect(screen.getByText(/2010~, 미국 나스닥100/)).toBeInTheDocument()
    // 코스피 TR 비교표는 해외지수일 때 숨긴다
    expect(screen.queryByText('KODEX 200 vs KODEX 200TR')).not.toBeInTheDocument()
  })

  it('계산기 처음 값은 내 계획 금액, 고치면 되돌리기 링크', async () => {
    planMock.monthly = 1_220_000
    renderPage()
    await screen.findByText('추천')
    const input = screen.getByLabelText(/^금액($|=)/) as HTMLInputElement
    expect(input.value).toBe('1220000')
    expect(screen.getByText(/‘내 계획’은 그대로/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /으로 되돌리기/ })).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: '500000' } })
    fireEvent.click(screen.getByRole('button', { name: '내 계획(122만원)으로 되돌리기' }))
    expect(input.value).toBe('1220000')
  })

  it('계획이 없으면 50만원 그대로, 되돌리기 링크 없음', async () => {
    renderPage()
    await screen.findByText('추천')
    expect((screen.getByLabelText(/^금액($|=)/) as HTMLInputElement).value).toBe('500000')
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

  it('기간 골라 보기는 시뮬레이터로 — 지금 구성·금액·기간을 채워 넘긴다', async () => {
    const Probe = () => <pre data-testid="sim-state">{JSON.stringify(useLocation().state)}</pre>
    render(
      <MemoryRouter initialEntries={['/accumulate']}>
        <Routes>
          <Route path="/accumulate" element={<AccumulatePage />} />
          <Route path="/plan-sim" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText('추천')
    expect(screen.queryByRole('button', { name: '기간 골라 보기' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '시뮬레이터에서 직접 바꿔 보기' }))
    const state = JSON.parse(screen.getByTestId('sim-state').textContent!)
    expect(state.simPrefill.slots[0].weights).toEqual({ kospi200: 100 })
    expect(state.simPrefill.years).toBe(10)
    expect(state.simPrefill.monthly).toBeGreaterThan(0)
  })

  it('앞으로의 경우의 수: 3번의 세 번째 보기로, 예측이 아니라고 밝히고 과거 분포 비교표는 숨긴다', async () => {
    renderPage()
    await screen.findByText('추천')
    fireEvent.click(screen.getByRole('button', { name: '앞으로 10년 경우의 수' }))
    expect(screen.getByRole('button', { name: '앞으로 10년 경우의 수' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('예측이 아닙니다.')).toBeInTheDocument()
    expect(screen.getByLabelText('끼워 넣을 사건')).toBeInTheDocument()
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

  it('1번 구성: 안 정했으면 국내만으로 계산하고, 반반을 고르면 아래 계산이 구성 이력으로 바뀌고 저장은 버튼으로', async () => {
    renderPage()
    await screen.findByText('처음이면 이걸로')
    expect(screen.getByText(/아직 구성을 정하지 않았어요/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /국내만/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('button', { name: '이 구성을 내 계획으로 정하기' })).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: /국내·해외 반반/ }))
    expect(screen.getByText(/2003~, 코스피200 50 · S&P500 50\)/)).toBeInTheDocument()
    expect(screen.getByLabelText('같은 지수의 다른 후보')).toBeInTheDocument()
    expect(apiFetchMock.mock.calls.some(([p, o]) => p === '/api/ui/investment-prefs' && (o as any)?.method === 'POST')).toBe(false)

    apiFetchMock.mockImplementationOnce((_p: string, o: any) => Promise.resolve({ data: { plan: { monthly: 0, mix: JSON.parse(o.body).plan.mix } } }))
    fireEvent.click(screen.getByRole('button', { name: '이 구성을 내 계획으로 정하기' }))
    await screen.findByText(/내 계획 구성을 '코스피200 50 · S&P500 50'\(으\)로 정했어요/)
    const [, opts] = apiFetchMock.mock.calls.find(([p, o]) => p === '/api/ui/investment-prefs' && (o as any)?.method === 'POST')!
    expect(JSON.parse((opts as any).body).plan.mix.map((e: any) => [e.index, e.weight])).toEqual([['kospi200', 0.5], ['sp500', 0.5]])
    expect(screen.getByRole('radio', { name: /국내·해외 반반.*내 계획/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('1번 구성: 저장된 직접 구성은 그대로 보이고 지수마다 상품 칸이 생긴다', async () => {
    planMock.mix = [
      { index: 'kospi200', weight: 0.7, product: null, account: null },
      { index: 'nasdaq100', weight: 0.3, product: null, account: null },
    ]
    renderPage()
    await screen.findByText('직접 정한 구성')
    expect(screen.getByLabelText<HTMLSelectElement>("같은 지수의 다른 후보").value).toMatch(/^[0-9A-Z]{6}$/)
    expect(screen.queryByText(/아직 구성을 정하지 않았어요/)).toBeNull()
  })

  it('2번에서 바꾼 금액을 그 자리에서 내 계획으로 정한다', async () => {
    planMock.monthly = 1_220_000
    renderPage()
    await screen.findAllByText('처음이면 이걸로')
    expect(screen.queryByRole('button', { name: /을 내 계획으로 정하기$/ })).toBeNull()
    fireEvent.change(screen.getByLabelText(/^금액($|=)/), { target: { value: '2000000' } })
    apiFetchMock.mockImplementationOnce(() => Promise.resolve({ data: { plan: { monthly: 2_000_000 } } }))
    fireEvent.click(screen.getByRole('button', { name: '매달 200만원을 내 계획으로 정하기' }))
    await screen.findByText('내 계획을 매달 200만원으로 바꿨어요')
    const [, opts] = apiFetchMock.mock.calls.find(([p, o]) => p === '/api/ui/investment-prefs' && (o as any)?.method === 'POST')!
    expect(JSON.parse((opts as any).body)).toEqual({ plan: { monthly: 2_000_000 } })
  })

  it('4번은 목표 트래커로 옮겼다 — 요약 한 줄과 바로 가기만', async () => {
    renderPage()
    await screen.findByText('처음이면 이걸로')
    expect(screen.getByRole('heading', { name: '4. 목표까지는' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '목표 트래커에서 보기' })).toBeInTheDocument()
    expect(screen.queryByText(/갖고 싶은 성장 자산/)).toBeNull()
  })

  it('예전에 이 화면에서만 지정한 코스피200 상품은 내 계획 구성으로 옮겨 저장한다', async () => {
    localStorage.setItem(userScopedKey('state:accumulate')!, JSON.stringify({ value: { target: { code: '069500', name: 'KODEX 200' } }, updatedAt: Date.now() }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '내 계획 구성에 넣기' }))
    fireEvent.click(screen.getByRole('button', { name: '이 구성을 내 계획으로 정하기' }))
    await waitFor(() => {
      const call = apiFetchMock.mock.calls.find(([path, opts]) => path === '/api/ui/investment-prefs' && (opts as { method?: string })?.method === 'POST')
      expect(call).toBeTruthy()
      const body = JSON.parse((call![1] as { body: string }).body)
      expect(body.plan.mix).toEqual([{ index: 'kospi200', weight: 1, product: { code: '069500', name: 'KODEX 200' }, account: null }])
    })
  })
})
