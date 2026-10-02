import { describe, expect, it } from 'vitest'
import {
  averageReceived, historyPrices, monthsToGain, recommendCandidate, requiredMonthly, simulateDca, situationGuide, summarize, toMonthly, trackSummary, upsertMonth, EMPTY_STATE,
} from '../lib/accumulate'
import type { IndexEtfCandidate } from '../data/accumulateData'

const flat = Array.from({ length: 60 }, () => 100)
const rising = Array.from({ length: 60 }, (_, i) => 100 * 1.01 ** i)

describe('simulateDca', () => {
  it('가격이 그대로면 평가금은 납입액과 같다', () => {
    const r = simulateDca({ monthly: 100_000, years: 2, prices: flat })!
    expect(r.months).toBe(24)
    expect(r.median[24]).toBeCloseTo(100_000 * 24, 0)
    expect(summarize(r).lossPct).toBe(0)
  })

  it('계속 오르면 중앙값이 납입액보다 크다', () => {
    const r = simulateDca({ monthly: 100_000, years: 2, prices: rising })!
    expect(r.median[24]).toBeGreaterThan(100_000 * 24)
    expect(r.worst[24]).toBeLessThanOrEqual(r.p10[24])
    expect(r.p10[24]).toBeLessThanOrEqual(r.median[24])
  })

  it('분배금 세금(drag)이 있으면 TR보다 결과가 작다', () => {
    const tr = simulateDca({ monthly: 100_000, years: 5, prices: historyPrices(), annualDrag: 0 })!
    const plain = simulateDca({ monthly: 100_000, years: 5, prices: historyPrices(), annualDrag: 0.003 })!
    expect(plain.median[60]).toBeLessThan(tr.median[60])
  })

  it('시작점이 너무 적으면 계산하지 않는다', () => {
    expect(simulateDca({ monthly: 1, years: 5, prices: flat })).toBeNull()
  })

  it('처음 가진 자산이 평가금에 더해진다', () => {
    const r = simulateDca({ monthly: 0, lump: 1_000_000, years: 1, prices: rising })!
    expect(r.median[12]).toBeCloseTo(1_000_000 * 1.01 ** 12, -2)
  })

  it('실제 이력 5년: 과거 실측 범위 안', () => {
    const s = summarize(simulateDca({ monthly: 500_000, years: 5 })!)
    expect(s.paid).toBe(30_000_000)
    expect(s.median / s.paid).toBeGreaterThan(1.1)
    expect(s.median / s.paid).toBeLessThan(1.3)
    expect(s.lossPct).toBeLessThan(15)
  })
})

describe('requiredMonthly / monthsToGain', () => {
  it('보수적 필요액이 일반적 필요액 이상이다', () => {
    const r = requiredMonthly({ target: 100_000_000, years: 10 })!
    expect(r.conservative).toBeGreaterThanOrEqual(r.typical)
    expect(r.typical * 12 * 10).toBeLessThan(100_000_000)
  })

  it('가진 자산이 있으면 필요한 월 적립이 줄어든다', () => {
    const none = requiredMonthly({ target: 100_000_000, years: 10 })!
    const some = requiredMonthly({ target: 100_000_000, years: 10, lump: 20_000_000 })!
    expect(some.typical).toBeLessThan(none.typical)
  })

  it('+20%까지 중앙값이 1~4년 사이', () => {
    const m = monthsToGain()
    expect(m.median).toBeGreaterThan(12)
    expect(m.median).toBeLessThan(48)
  })
})

describe('toMonthly', () => {
  it('일·주 단위를 월 금액으로 환산', () => {
    expect(toMonthly(10_000, 'day')).toBe(210_000)
    expect(toMonthly(100_000, 'week')).toBe(433_333)
    expect(toMonthly(300_000, 'month')).toBe(300_000)
    expect(toMonthly(-1, 'month')).toBe(0)
  })
})

describe('recommendCandidate', () => {
  const c = (code: string, kind: 'plain' | 'tr', fee: number, cap: number, trade: number, listed = '20180101'): IndexEtfCandidate =>
    ({ code, name: code, kind, feePct: fee, marketCapEok: cap, tradingValueMil: trade, listed, issuer: 'x' })
  const list = [
    c('BIG', 'tr', 0.05, 78_000, 8_000), c('CHEAP', 'tr', 0.012, 18_000, 7_000), c('SMALL', 'tr', 0.012, 5_000, 5_000),
    c('THIN', 'tr', 0.01, 20_000, 100), c('NEW', 'tr', 0.01, 20_000, 9_000, '20250101'), c('PLAIN', 'plain', 0.15, 258_000, 2_000_000),
  ]
  it('성장 목표는 TR 중 관문을 넘고 보수 차이가 작으면 규모가 큰 쪽', () => {
    const r = recommendCandidate('growth', list, '2026-10-02')
    expect(r.pick?.code).toBe('BIG')
    expect(r.eligible.map((x) => x.code)).toEqual(['BIG', 'CHEAP'])
  })
  it('보수 차이가 크면 싼 쪽을 고른다', () => {
    const r = recommendCandidate('growth', [c('BIG', 'tr', 0.3, 78_000, 8_000), c('CHEAP', 'tr', 0.012, 18_000, 7_000)], '2026-10-02')
    expect(r.pick?.code).toBe('CHEAP')
  })
  it('분배금이 필요하면 일반형', () => {
    expect(recommendCandidate('income', list, '2026-10-02').pick?.code).toBe('PLAIN')
  })
  it('실제 후보 데이터에서도 추천이 나온다', () => {
    expect(recommendCandidate('growth').pick?.kind).toBe('tr')
    expect(recommendCandidate('income').pick?.kind).toBe('plain')
  })
})

describe('situationGuide', () => {
  const series = (n: number, f: (i: number) => number, endDate = '2026-10-01') => {
    const end = Date.parse(endDate)
    return Array.from({ length: n }, (_, i) => ({ date: new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10), close: f(i) }))
  }
  const today = new Date('2026-10-02')
  it('시세가 짧으면 보류', () => expect(situationGuide(series(30, () => 100), today).state).toBe('short'))
  it('마지막 시세가 오래되면 보류 (낡은 가격으로 판단하지 않는다)', () => {
    expect(situationGuide(series(300, () => 100, '2026-09-01'), today).state).toBe('stale')
  })
  it('고점 대비 -15% 이하면 하락 안내', () => {
    const g = situationGuide(series(300, (i) => (i < 250 ? 100 : 80)), today)
    expect(g.state).toBe('drop')
    expect(g.text).toContain('멈추지 말고')
  })
  it('1년 +30%이고 고점 부근이면 상승 안내 — 줄이라고 하지 않는다', () => {
    const g = situationGuide(series(300, (i) => 100 * 1.003 ** i), today)
    expect(g.state).toBe('rally')
    expect(g.text).toContain('줄일 필요는 없습니다')
  })
  it('평범하면 그대로', () => expect(situationGuide(series(300, () => 100), today).state).toBe('normal'))
})

describe('기록', () => {
  it('진행 중인 달은 분배금 평균에서 뺀다', () => {
    const r = averageReceived([['2026-07', 300_000], ['2026-08', 330_000], ['2026-09', 360_000], ['2026-10', 244_646]], '2026-10')
    expect(r.avg).toBe(330_000)
    expect(r.partial).toBe(244_646)
    expect(r.months).toBe(3)
  })
  it('완료된 달이 없으면 평균 없음', () => {
    expect(averageReceived([['2026-10', 244_646]], '2026-10').avg).toBeNull()
  })
  it('같은 달은 덮어쓰고 0이면 지운다', () => {
    const a = upsertMonth([['2026-08', 1]], '2026-09', 5)
    expect(upsertMonth(a, '2026-09', 7)).toEqual([['2026-08', 1], ['2026-09', 7]])
    expect(upsertMonth(a, '2026-09', 0)).toEqual([['2026-08', 1]])
  })
  it('수익률 요약', () => {
    const s = trackSummary({ ...EMPTY_STATE, deposits: [['2026-08', 1_000_000], ['2026-09', 1_000_000]], valuation: { ym: '2026-10', value: 2_100_000 } })
    expect(s.paid).toBe(2_000_000)
    expect(s.gainPct).toBeCloseTo(5, 5)
  })
})
