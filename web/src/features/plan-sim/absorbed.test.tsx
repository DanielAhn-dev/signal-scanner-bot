import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PlanSimPage from './index'
import { planMixFromWeights } from './SetPlanMix'
import { SIM_STRESS_CLASS } from './StressSection'
import { SIM_ASSETS } from '../../data/simData'
import { MIX_PRESETS, simulateMix } from '../../lib/mix'

// 섞어보기(features/mix)에서 옮겨 온 기능 — 하락 가정·내 계획으로 정하기·하락 중에 팔았다면·하락 때 할 일
const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', async (orig) => ({ ...(await orig<typeof import('../../stores/profileStore')>()), useCurrentChatId: () => '' }))
beforeEach(() => apiFetchMock.mockReset())

const page = (state?: unknown) => render(<MemoryRouter initialEntries={[{ pathname: '/plan-sim', state }]}><PlanSimPage /></MemoryRouter>)

describe('하락 가정', () => {
  it('13자산 모두 하락 묶음이 있다(리츠는 주식, 현금은 그대로)', () => {
    for (const a of SIM_ASSETS) expect(SIM_STRESS_CLASS[a.id], a.id).toBeTruthy()
    expect(SIM_STRESS_CLASS.reits).toBe('equity')
    expect(SIM_STRESS_CLASS.cash).toBe('cash')
  })

  it('A 구성의 하락 결과와 버틸 선 판정을 보여 주고, 살펴볼 구성을 바꿀 수 있다', () => {
    page()
    expect(screen.getByText('하락이 왔다고 가정하면')).toBeTruthy()
    expect(screen.getByText('이 하락에서 이 구성')).toBeTruthy()
    fireEvent.click(screen.getByText('최악 가정'))
    expect(screen.getByText(/버틸 수 있는 선\(20%\)을 넘습니다/)).toBeTruthy()
    const b = within(screen.getByRole('group', { name: '살펴볼 구성' })).getByRole('button', { name: /^B 코스피200만/ })
    fireEvent.click(b)
    expect(b.getAttribute('aria-pressed')).toBe('true')
    // 코스피200만, 최악 가정 주식 -55%
    expect(screen.getByText('-55%', { selector: '.acc-tiles dd' })).toBeTruthy()
  })
})

describe('이 구성을 내 계획으로 정하기', () => {
  it('코스피200·S&P500·나스닥100만이면 구성으로 바꾸고, 다른 자산이 섞이면 null', () => {
    expect(planMixFromWeights({ kospi200: 60, sp500: 40 })?.map((e) => [e.index, e.weight])).toEqual([['kospi200', 0.6], ['sp500', 0.4]])
    const three = planMixFromWeights({ kospi200: 35, sp500: 35, nasdaq100: 35 })!
    expect(three.reduce((s, e) => s + e.weight, 0)).toBeCloseTo(1, 9)
    expect(planMixFromWeights({ kospi200: 60, kbond10: 40 })).toBeNull()
    expect(planMixFromWeights({ kospi200: 60, cash: 40 })).toBeNull()
    expect(planMixFromWeights({ sp500: 0 })).toBeNull()
    const keep = [{ index: 'sp500' as const, weight: 1, product: { code: '360200', name: 'ACE 미국S&P500' }, account: { broker: '토스', account: 'ISA' } }]
    expect(planMixFromWeights({ kospi200: 50, sp500: 50 }, keep)![1]).toMatchObject({ product: { code: '360200' }, account: { account: 'ISA' } })
  })

  it('A(반반)는 버튼으로 저장하고(지금 구성을 다시 읽어 합침), 채권이 섞인 구성은 안내만', async () => {
    apiFetchMock.mockImplementation((_u: string, o?: { method?: string; body?: string }) =>
      Promise.resolve(o?.method === 'POST' ? { data: { plan: JSON.parse(o.body!).plan } } : { data: { plan: { monthly: 0, mix: null } } }))
    page()
    fireEvent.click(screen.getByRole('button', { name: /이 구성을 내 계획으로 정하기/ }))
    expect(await screen.findByText(/내 계획 구성을 '.+'\(으\)로 정했어요/)).toBeTruthy()
    const post = apiFetchMock.mock.calls.find(([, o]) => o?.method === 'POST')!
    expect(JSON.parse(post[1].body).plan.mix.map((e: any) => e.index)).toEqual(['kospi200', 'sp500'])

    fireEvent.click(screen.getByRole('button', { name: '+ 비교 추가' }))
    fireEvent.click(screen.getAllByRole('button', { name: '바꾸기' })[2])
    fireEvent.click(screen.getAllByText('코스피200 60 · 국고채 40').at(-1)!)
    fireEvent.click(within(screen.getByRole('group', { name: '살펴볼 구성' })).getByRole('button', { name: /^C / }))
    expect(screen.getByText(/다른 자산\(채권·금·현금 등\)이 섞인 구성은/)).toBeTruthy()
  })
})

describe('하락 중에 팔았다면·하락 때 할 일', () => {
  it('하락 중에 팔았다면 카드와 주의 문구', () => {
    page()
    expect(screen.getByText('하락 중에 팔았다면')).toBeTruthy()
    expect(screen.getByText(/보유보다 나았던 경우/)).toBeTruthy()
    fireEvent.click(screen.getByText('매월 적립'))
    expect(screen.getAllByText(/넣은 돈 대비/).length).toBeGreaterThan(0)
  })

  it('하락 때 할 일 — 모두 해제하면 저장할 수 없다', () => {
    page()
    expect(screen.getByText('하락이 오면 내가 할 일, 미리 정해 두기')).toBeTruthy()
    const save = screen.getByText('이 계획으로 정하기') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    expect(save.disabled).toBe(true)
  })
})

describe('시드 만들기에서 넘어오면', () => {
  it('확인한 가용 현금을 처음에 한 번에 넣는 돈으로 채운다', () => {
    page({ seedBuilderCapital: 3_000_000 })
    expect((screen.getByLabelText('처음에 한 번에 (만원)') as HTMLInputElement).value).toBe('300')
  })
})

describe('실제 데이터 점검 (섞어보기에서 옮김)', () => {
  it('한국 상장 4종 조합은 파이썬 검증(연 12.3%, 낙폭 -19%)과 비슷하다', () => {
    const r = simulateMix(MIX_PRESETS.find((p) => p.key === 'mix4')!.weights, 'month')!
    expect(r.from).toBe('201111')
    expect(r.cagr).toBeGreaterThan(0.11)
    expect(r.cagr).toBeLessThan(0.135)
    expect(r.mdd).toBeGreaterThan(-0.23)
    expect(r.mdd).toBeLessThan(-0.15)
  })
})
