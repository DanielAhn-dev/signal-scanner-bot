import { describe, expect, it } from 'vitest'
import { simulateGap, summarizeGap, type GapParams } from '../lib/behaviorGap'

const base: GapParams = { mode: 'lump', years: 1, trigger: 0.2, reentry: 'months6', cashAnnual: 0 }
const dates = (n: number) => Array.from({ length: n }, (_, i) => `2020${String(1 + Math.floor(i / 21)).padStart(2, '0')}${String(1 + (i % 21)).padStart(2, '0')}`)
/** 거래일 250일짜리 가격표 — 앞쪽 값만 정하고 나머지는 마지막 값 유지 */
const path = (head: number[], n = 260) => Array.from({ length: n }, (_, i) => head[Math.min(i, head.length - 1)])

describe('simulateGap', () => {
  it('떨어지지 않으면 팔지 않고 보유와 같다', () => {
    const close = Array.from({ length: 300 }, (_, i) => 100 * 1.001 ** i)
    const r = simulateGap(close, dates(300), 0, base)!
    expect(r.sold).toBe(false)
    expect(r.sell).toBeCloseTo(r.hold, 10)
  })

  it('판정 다음 거래일 종가에 팔고 재매수도 다음 거래일 종가에 한다', () => {
    // 3일째 종가 79(-21%) → 4일째(70)에 매도, 이후 70 유지. 125일 뒤 판정 → 다음 날 재매수
    const close = path([100, 100, 79, 70], 300)
    const r = simulateGap(close, dates(300), 0, base)!
    expect(r.sold).toBe(true)
    expect(r.hold).toBeCloseTo(0.7, 10)
    expect(r.sell).toBeCloseTo(0.7, 10) // 70에 팔고 70에 다시 샀다
  })

  it('팔고 나서 더 떨어지면 판 쪽이 낫다', () => {
    const close = [...path([100, 100, 79, 60, 50], 125 + 5), ...Array.from({ length: 170 }, () => 50)]
    const r = simulateGap(close, dates(close.length), 0, { ...base, years: 1 })!
    expect(r.sell).toBeGreaterThan(r.hold)
  })

  it('팔고 바로 오르면 보유보다 못하다', () => {
    const close = [100, 100, 79, 79, 100, ...Array.from({ length: 295 }, () => 120)]
    const r = simulateGap(close, dates(close.length), 0, base)!
    expect(r.sell).toBeLessThan(r.hold)
  })

  it('적립은 총납입 대비 배율로 비교한다', () => {
    const close = Array.from({ length: 300 }, () => 100)
    const r = simulateGap(close, dates(300), 0, { ...base, mode: 'dca' })!
    expect(r.hold).toBeCloseTo(1, 10)
    expect(r.sell).toBeCloseTo(1, 10)
  })

  it('기간이 데이터보다 길면 null', () => {
    expect(simulateGap([100, 100], ['20200101', '20200102'], 0, base)).toBeNull()
  })
})

describe('summarizeGap(코스피200 실제 일별 데이터)', () => {
  it('일시금 5년·고점회복 재매수에서 팔고 다시 산 쪽이 대체로 보유보다 못했다', () => {
    const s = summarizeGap({ mode: 'lump', years: 5, trigger: 0.2, reentry: 'recover', cashAnnual: 0.025 })!
    expect(s.touched).toBeGreaterThan(150)
    expect(s.sell.median).toBeLessThan(s.hold.median)
    expect(s.sellWins).toBeLessThan(0.3)
  })

  it('10년은 5년보다 팔고 다시 산 쪽이 이기는 경우가 더 적다', () => {
    const five = summarizeGap({ mode: 'lump', years: 5, trigger: 0.2, reentry: 'rebound', cashAnnual: 0.025 })!
    const ten = summarizeGap({ mode: 'lump', years: 10, trigger: 0.2, reentry: 'rebound', cashAnnual: 0.025 })!
    expect(ten.sellWins).toBeLessThan(five.sellWins)
  })

  it('적립식도 같은 방향이다', () => {
    const s = summarizeGap({ mode: 'dca', years: 10, trigger: 0.2, reentry: 'rebound', cashAnnual: 0.025 })!
    expect(s.sell.median).toBeLessThan(s.hold.median)
  })
})
