import { describe, expect, it } from 'vitest'
import type { MixAsset } from '../data/mixData'
import { compareMethods, summarizeWholeChoice, wholeChoiceOutcomes } from '../lib/wholeChoice'

/** 월말 가격 배열로 가짜 자산 하나 — 첫 값이 기준이고 그 뒤 달마다 수익률이 생긴다 */
function asset(prices: number[]): MixAsset {
  const monthly = prices.map((p, i) => {
    const y = 2000 + Math.floor(i / 12)
    const m = (i % 12) + 1
    return [`${y}${String(m).padStart(2, '0')}`, p] as [string, number]
  })
  return { id: 'x', name: 'x', source: 't', dragPct: 0, first: monthly[0][0], monthly }
}
const flat = (n: number, v = 100) => Array.from({ length: n }, () => v)

describe('wholeChoice', () => {
  it('가격이 그대로면 어느 방식이든 끝에 원금 그대로, 손실도 없다', () => {
    const a = [asset(flat(40))]
    for (const m of ['lump', 'split6', 'split12'] as const) {
      const rows = wholeChoiceOutcomes({ x: 100 }, m, 1, a)
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) {
        expect(r.end).toBeCloseTo(1, 9)
        expect(r.low).toBeCloseTo(1, 9)
      }
    }
  })

  it('첫 시작 달은 첫 수익률 달의 전달로 적는다', () => {
    const rows = wholeChoiceOutcomes({ x: 100 }, 'lump', 1, [asset(flat(40))])
    // 가격 첫 달 200001이 기준값, 첫 수익률 달은 200002 → 시작은 200001 말
    expect(rows[0].start).toBe('200001')
    expect(rows[1].start).toBe('200002')
  })

  it('한 번에 넣고 바로 반토막이 나면 끝·도중 최저 모두 그 손실, 12개월 나눠 넣으면 덜 아프다', () => {
    // 첫 달에 반토막 난 뒤 그대로
    const prices = [100, 50, ...flat(30, 50)]
    const lump = wholeChoiceOutcomes({ x: 100 }, 'lump', 1, [asset(prices)])
    const split = wholeChoiceOutcomes({ x: 100 }, 'split12', 1, [asset(prices)])
    expect(lump[0].end).toBeCloseTo(0.5, 6)
    expect(lump[0].low).toBeCloseTo(0.5, 6)
    expect(lump[0].firstYearLow).toBeCloseTo(0.5, 6)
    // 12회 중 첫 회만 반토막: 1/12 × 0.5 + 11/12
    expect(split[0].end).toBeCloseTo(1 - 0.5 / 12, 6)
    expect(split[0].low).toBeGreaterThan(lump[0].low)
    const cmp = compareMethods(lump, split)!
    expect(cmp.n).toBe(lump.length)
    expect(cmp.otherLowerPainShare).toBeGreaterThan(0)
  })

  it('이력이 기간보다 짧으면 빈 결과', () => {
    expect(wholeChoiceOutcomes({ x: 100 }, 'lump', 10, [asset(flat(40))])).toEqual([])
    expect(summarizeWholeChoice([], 1)).toBeNull()
  })

  it('요약: 가장 좋은·나쁜 시작 달, 원금 아래 비율, 첫해 −10% 비율, 겹치지 않는 창 수', () => {
    const s = summarizeWholeChoice([
      { start: '200001', end: 1.5, low: 0.95, firstYearLow: 0.95 },
      { start: '200002', end: 0.8, low: 0.7, firstYearLow: 0.85 },
      { start: '200003', end: 1.1, low: 0.9, firstYearLow: 0.92 },
      { start: '200004', end: 1.0, low: 1.0, firstYearLow: 1.0 },
    ], 1)!
    expect(s.bestStart).toBe('200001')
    expect(s.worstStart).toBe('200002')
    expect(s.end.best).toBe(1.5)
    expect(s.end.worst).toBe(0.8)
    expect(s.end.median).toBeCloseTo(1.05, 9)
    expect(s.belowPrincipalShare).toBe(0.25)
    expect(s.firstYearHit10Share).toBe(0.25)
    expect(s.independent).toBe(1)
  })
})
