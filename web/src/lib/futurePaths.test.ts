import { describe, expect, it } from 'vitest'
import { FUTURE_EVENTS, FUTURE_MATERIAL, type FutureEvent } from '../data/futureMaterial'
import { mulberry32, shareAtLeast, simulateFuture } from './futurePaths'

const flat = (len: number, r: number) => Array.from({ length: len }, () => r)
const material = (k: number, s: number, q: number, len = 60) => ({ kospi200: flat(len, k), sp500: flat(len, s), nasdaq100: flat(len, q) })
const ev = (returns: number[]): FutureEvent => ({
  key: 'drop', label: '테스트', from: '', to: '', note: '', assumed: false,
  returns: { kospi200: returns, sp500: returns, nasdaq100: returns },
  troughPct: { kospi200: 0, sp500: 0, nasdaq100: 0 }, endPct: { kospi200: 0, sp500: 0, nasdaq100: 0 },
})

describe('앞으로 10년 경우의 수 계산', () => {
  it('수익률이 0이면 모든 경우가 넣은 돈 그대로다', () => {
    const r = simulateFuture({ mix: [{ index: 'kospi200', weight: 1 }], monthly: 100, years: 2, paths: 50, returns: material(0, 0, 0) })
    expect(r.typical).toBeCloseTo(1)
    expect(r.belowPrincipalPct).toBe(0)
    expect(r.paid[24]).toBe(2400)
    expect(r.median[24]).toBeCloseTo(2400)
  })

  it('매달 초 넣고 그 달 수익을 받는다(적립식 닫힌 식과 같다)', () => {
    const r = simulateFuture({ mix: [{ index: 'sp500', weight: 1 }], monthly: 1, years: 1, paths: 3, returns: material(0, 0.01, 0) })
    const expected = Array.from({ length: 12 }, (_, i) => 1.01 ** (12 - i)).reduce((a, b) => a + b, 0)
    expect(r.median[12]).toBeCloseTo(expected)
  })

  it('매달 비중을 맞추므로 +1%와 -1%를 반반 섞으면 0%다', () => {
    const r = simulateFuture({ mix: [{ index: 'kospi200', weight: 0.5 }, { index: 'sp500', weight: 0.5 }], monthly: 10, years: 3, paths: 20, returns: material(0.01, -0.01, 0) })
    expect(r.typical).toBeCloseTo(1)
  })

  it('같은 씨앗이면 같은 결과이고, 구성을 바꿔도 같은 달들을 겪는다', () => {
    const returns = { kospi200: Array.from({ length: 48 }, (_, i) => (i % 7) / 100 - 0.02), sp500: Array.from({ length: 48 }, (_, i) => (i % 5) / 100 - 0.015), nasdaq100: flat(48, 0) }
    const a = simulateFuture({ mix: [{ index: 'kospi200', weight: 1 }], monthly: 1, years: 5, paths: 100, returns })
    const b = simulateFuture({ mix: [{ index: 'kospi200', weight: 1 }], monthly: 1, years: 5, paths: 100, returns })
    expect(a.finalRatios).toEqual(b.finalRatios)
    // 나스닥100(수익 0) 비중 0%짜리 섞기는 코스피200 100%와 같은 달들을 겪으므로 결과가 같다
    const c = simulateFuture({ mix: [{ index: 'kospi200', weight: 1 }, { index: 'nasdaq100', weight: 0 }], monthly: 1, years: 5, paths: 100, returns })
    expect(c.finalRatios).toEqual(a.finalRatios)
    const d = simulateFuture({ mix: [{ index: 'kospi200', weight: 1 }], monthly: 1, years: 5, paths: 100, returns, seed: 7 })
    expect(d.finalRatios).not.toEqual(a.finalRatios)
  })

  it('사건은 고른 해에 실제 경로 그대로 들어간다', () => {
    const r = simulateFuture({
      mix: [{ index: 'kospi200', weight: 1 }], monthly: 0, lump: 100, years: 5, paths: 10,
      returns: material(0, 0, 0), events: [ev([-0.5, 0.2])], event: { key: 'drop', atYear: 2 },
    })
    expect(r.event?.key).toBe('drop')
    expect(r.median[24]).toBeCloseTo(100)
    expect(r.median[25]).toBeCloseTo(50)
    expect(r.median[26]).toBeCloseTo(60)
    expect(r.median[60]).toBeCloseTo(60)
    expect(r.deepest?.troughPct).toBeCloseTo(-50)
    expect(r.deepest?.troughStep).toBe(25)
    expect(r.eventCutMonths).toBe(0)
  })

  it('기간 안에 다 못 들어간 사건은 잘린 개월 수를 알린다', () => {
    const r = simulateFuture({
      mix: [{ index: 'kospi200', weight: 1 }], monthly: 1, years: 2, paths: 5,
      returns: material(0, 0, 0), events: [ev(flat(20, -0.01))], event: { key: 'drop', atYear: 1 },
    })
    expect(r.eventCutMonths).toBe(8)
  })

  it('겹쳐 그릴 경우를 정하지 않으면 끝 결과가 보통에 가장 가까운 경로', () => {
    const returns = { kospi200: Array.from({ length: 48 }, (_, i) => (i % 7) / 100 - 0.02), sp500: flat(48, 0), nasdaq100: flat(48, 0) }
    const r = simulateFuture({ mix: [{ index: 'kospi200', weight: 1 }], monthly: 1, years: 5, paths: 101, returns })
    expect(r.deepest!.finalRatio).toBeCloseTo(r.typical, 1)
    const fixed = simulateFuture({ mix: [{ index: 'kospi200', weight: 1 }], monthly: 1, years: 5, paths: 101, returns, caseIndex: 3 })
    expect(fixed.caseIndex).toBe(3)
    expect(fixed.deepest!.start).toBe('경우 4')
  })

  it('목표 이상인 경우의 비율', () => {
    const r = simulateFuture({ mix: [{ index: 'kospi200', weight: 1 }], monthly: 100, years: 1, paths: 10, returns: material(0, 0, 0) })
    expect(shareAtLeast(r, 1200)).toBe(100)
    expect(shareAtLeast(r, 1201)).toBe(0)
  })

  it('씨앗 수열은 0~1 사이', () => {
    const rand = mulberry32(1)
    for (let i = 0; i < 100; i += 1) {
      const x = rand()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('생성된 재료로 돌린 결과', () => {
  it('재료는 1999-04부터이고 세 지수 길이가 같다', () => {
    expect(FUTURE_MATERIAL.from).toBe('199904')
    expect(FUTURE_MATERIAL.returns.sp500.length).toBe(FUTURE_MATERIAL.months)
    expect(FUTURE_MATERIAL.returns.nasdaq100.length).toBe(FUTURE_MATERIAL.months)
  })

  it('운 나쁨 ≤ 보통 ≤ 운 좋음, 일본처럼 끼우면 원금 아래 경우가 늘어난다', () => {
    const mix = [{ index: 'kospi200' as const, weight: 0.5 }, { index: 'sp500' as const, weight: 0.5 }]
    const base = simulateFuture({ mix, monthly: 1_000_000, paths: 500 })
    expect(base.low).toBeLessThanOrEqual(base.typical)
    expect(base.typical).toBeLessThanOrEqual(base.high)
    const japan = simulateFuture({ mix, monthly: 1_000_000, paths: 500, event: { key: 'japan', atYear: 0 } })
    expect(japan.belowPrincipalPct).toBeGreaterThan(base.belowPrincipalPct)
  })

  it('닷컴 붕괴는 나스닥100 비중이 클수록 더 아프다', () => {
    const dot = FUTURE_EVENTS.find((e) => e.key === 'dotcom')!
    expect(dot.troughPct.nasdaq100).toBeLessThan(dot.troughPct.kospi200)
    const nas = simulateFuture({ mix: [{ index: 'nasdaq100', weight: 1 }], monthly: 1, paths: 300, event: { key: 'dotcom', atYear: 2 } })
    const nasNone = simulateFuture({ mix: [{ index: 'nasdaq100', weight: 1 }], monthly: 1, paths: 300 })
    expect(nas.typical).toBeLessThan(nasNone.typical)
  })
})
