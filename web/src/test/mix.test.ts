import { describe, expect, it } from 'vitest'
import { normalize, simulateMix } from '../lib/mix'
import type { MixAsset } from '../data/mixData'

const asset = (id: string, start: string, f: (i: number) => number, n = 72, dragPct = 0): MixAsset => {
  const y0 = Number(start.slice(0, 4))
  return {
    id, name: id, source: '', dragPct, first: start,
    monthly: Array.from({ length: n }, (_, i) => {
      const m = i % 12
      return [`${y0 + Math.floor(i / 12)}${String(m + 1).padStart(2, '0')}`, f(i)] as [string, number]
    }),
  }
}

describe('simulateMix', () => {
  it('비중을 100으로 맞춘다', () => {
    expect(normalize({ a: 30, b: 10 })).toEqual({ a: 0.75, b: 0.25 })
    expect(normalize({ a: 0 })).toEqual({})
  })

  it('한 자산 100%면 그 자산의 연수익과 같다(리밸런싱 비용 없음)', () => {
    const a = asset('a', '2010', (i) => 100 * 1.01 ** i)
    const r = simulateMix({ a: 100 }, 'month', [a])!
    expect(r.cagr).toBeCloseTo(1.01 ** 12 - 1, 3)
    expect(r.mdd).toBe(0)
  })

  it('기간은 비중이 있는 자산 중 가장 짧은 이력이 정한다', () => {
    const a = asset('a', '2010', (i) => 100 + i)
    const b = asset('b', '2013', (i) => 100 + i, 36)
    const r = simulateMix({ a: 50, b: 50 }, 'year', [a, b])!
    expect(r.from).toBe('201302')
    expect(simulateMix({ a: 100 }, 'year', [a, b])!.from).toBe('201002')
  })

  it('반대로 움직이는 두 자산을 섞으면 낙폭이 줄어든다', () => {
    const up = asset('u', '2010', (i) => (i % 24 < 12 ? 100 + i * 5 : 100 + (24 - (i % 24)) * 5), 96)
    const dn = asset('d', '2010', (i) => (i % 24 < 12 ? 100 + (12 - (i % 24)) * 5 : 100 + (i % 24 - 12) * 5), 96)
    const mixed = simulateMix({ u: 50, d: 50 }, 'month', [up, dn])!
    const alone = simulateMix({ u: 100 }, 'month', [up, dn])!
    expect(mixed.mdd).toBeGreaterThan(alone.mdd)
  })

  it('원본 대비 격차(dragPct)가 있으면 수익이 낮아진다', () => {
    const plain = asset('a', '2010', (i) => 100 * 1.01 ** i)
    const dragged = asset('a', '2010', (i) => 100 * 1.01 ** i, 72, 0.9)
    expect(simulateMix({ a: 1 }, 'month', [dragged])!.cagr).toBeLessThan(simulateMix({ a: 1 }, 'month', [plain])!.cagr)
  })

  it('없는 자산이나 12개월 미만이면 null', () => {
    expect(simulateMix({ zz: 100 }, 'month', [])).toBeNull()
    expect(simulateMix({ a: 100 }, 'month', [asset('a', '2010', () => 100, 8)])).toBeNull()
  })
})
