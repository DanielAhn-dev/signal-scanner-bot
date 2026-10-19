import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MixPage from './index'
import { planMixFromWeights } from './SetPlanMix'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
beforeEach(() => apiFetchMock.mockReset())
import { MIX_PRESETS, simulateMix } from '../../lib/mix'

describe('섞어보기 화면', () => {
  it('예시 조합의 결과와 기준선, 주의 문구를 보여준다', () => {
    render(<MixPage />)
    expect(screen.getByText('연평균 수익률')).toBeTruthy()
    expect(screen.getByText('최대 낙폭')).toBeTruthy()
    expect(screen.getByText(/코스피200 100% \(같은 기간\)/)).toBeTruthy()
    expect(screen.getByText(/미국이 유독 강했던 구간/)).toBeTruthy()
  })

  it('비중을 모두 0으로 만들면 안내를 보여준다', () => {
    render(<MixPage />)
    for (const s of screen.getAllByRole('slider')) fireEvent.change(s, { target: { value: '0' } })
    expect(screen.getByText(/비중을 하나 이상 정해주세요/)).toBeTruthy()
  })
})

describe('하락 가정', () => {
  it('하락 가정 결과와 버틸 수 있는 선 판정을 보여준다', () => {
    render(<MixPage />)
    expect(screen.getByText('하락이 왔다고 가정해보기')).toBeTruthy()
    expect(screen.getByText('이 하락에서 내 조합')).toBeTruthy()
    fireEvent.click(screen.getByText('최악 가정'))
    expect(screen.getByText(/버틸 수 있는 선\(20%\)을 넘습니다/)).toBeTruthy()
  })
})

describe('하락 중에 팔았다면', () => {
  it('조건에 따른 결과와 주의 문구를 보여준다', () => {
    render(<MixPage />)
    expect(screen.getByText('하락 중에 팔았다면')).toBeTruthy()
    expect(screen.getByText(/보유보다 나았던 경우/)).toBeTruthy()
    expect(screen.getByText(/몇 번의 큰 하락에 걸려 있습니다/)).toBeTruthy()
    fireEvent.click(screen.getByText('매월 적립'))
    expect(screen.getByText(/넣은 돈 대비/)).toBeTruthy()
  })
})

describe('실제 데이터 점검', () => {
  it('한국 상장 4종 조합은 파이썬 검증(연 12.3%, 낙폭 -19%)과 비슷하다', () => {
    const r = simulateMix(MIX_PRESETS.find((p) => p.key === 'mix4')!.weights, 'month')!
    expect(r.from).toBe('201111')
    expect(r.cagr).toBeGreaterThan(0.11)
    expect(r.cagr).toBeLessThan(0.135)
    expect(r.mdd).toBeGreaterThan(-0.23)
    expect(r.mdd).toBeLessThan(-0.15)
  })
})

describe('하락 때 할 일 미리 정하기', () => {
  it('항목과 저장 버튼을 보여주고, 모두 해제하면 저장할 수 없다', () => {
    render(<MixPage />)
    expect(screen.getByText('하락이 오면 내가 할 일, 미리 정해 두기')).toBeTruthy()
    const save = screen.getByText('이 계획으로 정하기') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    expect(save.disabled).toBe(true)
  })
})

describe('이 비중으로 내 계획 정하기', () => {
  it('코스피200·S&P500·나스닥100만이면 구성으로 바꾸고, 채권·금이 섞이면 null', () => {
    expect(planMixFromWeights({ kospi200: 60, sp500: 40 })?.map((e) => [e.index, e.weight])).toEqual([['kospi200', 0.6], ['sp500', 0.4]])
    const three = planMixFromWeights({ kospi200: 35, sp500: 35, nasdaq100: 35 })!
    expect(three.reduce((s, e) => s + e.weight, 0)).toBeCloseTo(1, 9)
    expect(planMixFromWeights({ kospi200: 60, kbond10: 40 })).toBeNull()
    expect(planMixFromWeights({ sp500: 0 })).toBeNull()
    // 이미 고른 상품·계좌는 남긴다
    const keep = [{ index: 'sp500' as const, weight: 1, product: { code: '360200', name: 'ACE 미국S&P500' }, account: { broker: '토스', account: 'ISA' } }]
    expect(planMixFromWeights({ kospi200: 50, sp500: 50 }, keep)![1]).toMatchObject({ product: { code: '360200' }, account: { account: 'ISA' } })
  })

  it('채권·금이 섞인 예시는 버튼 대신 안내, 주식 반반 예시는 버튼으로 저장(지금 구성을 다시 읽어 합침)', async () => {
    apiFetchMock.mockImplementation((_u: string, o?: { method?: string; body?: string }) =>
      Promise.resolve(o?.method === 'POST' ? { data: { plan: JSON.parse(o.body!).plan } } : { data: { plan: { monthly: 0, mix: null } } }))
    render(<MixPage />)
    expect(screen.getByText(/채권·금이 섞인 비중은 내 계획 구성으로 정할 수 없어요/)).toBeTruthy()
    fireEvent.click(screen.getByText('코스피200 50 · 나스닥100 50'))
    fireEvent.click(screen.getByRole('button', { name: /이 비중을 내 계획 구성으로 정하기/ }))
    expect(await screen.findByText(/내 계획 구성을 '코스피200 50 · 나스닥100 50'\(으\)로 정했어요/)).toBeTruthy()
    const post = apiFetchMock.mock.calls.find(([, o]) => o?.method === 'POST')!
    expect(JSON.parse(post[1].body).plan.mix.map((e: any) => e.index)).toEqual(['kospi200', 'nasdaq100'])
  })
})
