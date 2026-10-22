import { describe, expect, it } from 'vitest'
import { MIX_ASSETS, type MixAsset } from '../../data/mixData'
import { simulatePeriod } from '../accumulate'
import { MIX_PRESETS, simulateMix, type Rebalance } from '../mix'
import { annualIrr, commonMonths, rollingStarts, simulatePlan } from './engine'

const asset = (id: string, start: string, f: (i: number) => number, n = 72, dragPct = 0): MixAsset => {
  const y0 = Number(start.slice(0, 4))
  return {
    id, name: id, source: '', dragPct, first: `${start}01`,
    monthly: Array.from({ length: n }, (_, i) => [`${y0 + Math.floor(i / 12)}${String((i % 12) + 1).padStart(2, '0')}`, f(i)] as [string, number]),
  }
}

describe('불변: 섞어보기 simulateMix와 같은 값', () => {
  const cases: Array<[string, Record<string, number>]> = MIX_PRESETS.map((p) => [p.key, p.weights])
  for (const [key, weights] of cases) {
    for (const rb of ['month', 'year', 'none'] as Rebalance[]) {
      it(`${key} · ${rb}: 일시금 1, 적립 0이면 평가금 = curve`, () => {
        const mix = simulateMix(weights, rb)!
        const r = simulatePlan({ weights, rebalance: rb, lump: 1 })!
        expect(r.labels.slice(1)).toEqual(mix.yms.slice(1))
        expect(r.value.length).toBe(mix.curve.length)
        r.value.forEach((v, i) => expect(v).toBeCloseTo(mix.curve[i], 10))
        r.index.forEach((v, i) => expect(v).toBeCloseTo(mix.curve[i], 10))
        expect(r.stats.cagr).toBeCloseTo(mix.cagr, 10)
        expect(r.stats.mdd).toBeCloseTo(mix.mdd, 10)
      })
    }
  }
})

describe('불변: 모아가기 simulatePeriod와 같은 값 (코스피200 하나, drag 0)', () => {
  const kospi = MIX_ASSETS.find((a) => a.id === 'kospi200')!
  const windows: Array<[string, string]> = [['200710', '201712'], ['202001', '202512'], ['200210', '202609']]
  for (const [startYm, endYm] of windows) {
    it(`${startYm}~${endYm} 월 50 + 일시금 300`, () => {
      const old = simulatePeriod({ startYm, endYm, monthly: 50, lump: 300, series: kospi.monthly })!
      const r = simulatePlan({ weights: { kospi200: 1 }, startYm, endYm, monthly: 50, lump: 300 })!
      expect(r.labels).toEqual(old.labels)
      expect(r.paid).toEqual(old.paid)
      r.value.forEach((v, i) => expect(v).toBeCloseTo(old.value[i], 6))
      expect(r.stats.trough?.ym ?? null).toBe(old.trough?.ym ?? null)
      if (old.trough) expect(r.stats.trough!.pct).toBeCloseTo(old.trough.pct, 6)
      expect(r.stats.recoveryMonths).toBe(old.recoveryMonths)
      const roll = rollingStarts({ weights: { kospi200: 1 }, startYm, endYm, monthly: 50, lump: 300 })!
      expect(roll.count).toBe(old.peers)
      expect(roll.worsePct).toBeCloseTo(old.worsePct, 10)
    })
  }

  it('drag가 있어도 거의 같다(적용 방식 차이만)', () => {
    const sp = MIX_ASSETS.find((a) => a.id === 'sp500')!
    const old = simulatePeriod({ startYm: '201001', endYm: '202012', monthly: 10, series: sp.monthly, annualDrag: sp.dragPct / 100 })!
    const r = simulatePlan({ weights: { sp500: 1 }, startYm: '201001', endYm: '202012', monthly: 10 })!
    expect(Math.abs(r.stats.endValue / old.value[old.months] - 1)).toBeLessThan(0.002)
  })
})

describe('simulatePlan', () => {
  it('기간 밖·시작≥끝·없는 자산이면 null', () => {
    const a = asset('a', '2010', () => 100)
    expect(simulatePlan({ weights: { a: 1 }, startYm: '200001', assets: [a] })).toBeNull()
    expect(simulatePlan({ weights: { a: 1 }, startYm: '201005', endYm: '201005', assets: [a] })).toBeNull()
    expect(simulatePlan({ weights: { b: 1 }, assets: [a] })).toBeNull()
    expect(simulatePlan({ weights: {}, assets: [a] })).toBeNull()
  })

  it('공통 월은 가장 늦게 시작하는 자산부터', () => {
    const a = asset('a', '2010', () => 100)
    const b = asset('b', '2012', () => 100, 48)
    const m = commonMonths({ a: 1, b: 1 }, [a, b])
    expect(m[0]).toBe('201201')
    expect(m.at(-1)).toBe('201512')
  })

  it('해마다 적립액을 늘린다(12개월마다)', () => {
    const a = asset('a', '2010', () => 100, 30)
    const r = simulatePlan({ weights: { a: 1 }, monthly: 100, monthlyRaisePct: 0.1, assets: [a], startYm: '201001', endYm: '201201' })!
    // 0~11번째 달 100, 12~23번째 110 → 24번째 달(끝)에는 넣지 않음
    expect(r.stats.paidTotal).toBeCloseTo(12 * 100 + 12 * 110)
    expect(r.stats.endValue).toBeCloseTo(r.stats.paidTotal)
    expect(r.stats.irr).toBeCloseTo(0, 6)
  })

  it('내 돈 연수익률: 매달 1%면 일시금이든 적립이든 연 12.68%', () => {
    const a = asset('a', '2010', (i) => 100 * 1.01 ** i)
    const lumpOnly = simulatePlan({ weights: { a: 1 }, lump: 1000, assets: [a] })!
    const dca = simulatePlan({ weights: { a: 1 }, monthly: 10, assets: [a] })!
    expect(lumpOnly.stats.irr).toBeCloseTo(1.01 ** 12 - 1, 6)
    expect(dca.stats.irr).toBeCloseTo(1.01 ** 12 - 1, 6)
    expect(lumpOnly.stats.cagr).toBeCloseTo(1.01 ** 12 - 1, 6)
  })

  it('원금 아래였던 가장 긴 연속 기간', () => {
    // 100 → 80(3달) → 100 이후 유지
    const px = [100, 80, 80, 80, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]
    const a = asset('a', '2010', (i) => px[i], px.length)
    const r = simulatePlan({ weights: { a: 1 }, lump: 100, assets: [a] })!
    expect(r.stats.longestUnderwaterMonths).toBe(3)
    expect(r.stats.trough?.ym).toBe('201002')
    expect(r.stats.recoveryMonths).toBe(3)
  })

  it("'cashflow'는 새 돈을 모자란 자산에 먼저 넣는다", () => {
    // a는 100 → 200 → 400, b는 제자리
    const a = asset('a', '2010', (i) => [100, 200, 400][i], 3)
    const b = asset('b', '2010', () => 100, 3)
    const run = (rebalance: 'cashflow' | 'none', monthly: number) =>
      simulatePlan({ weights: { a: 1, b: 1 }, lump: 200, monthly, rebalance, assets: [a, b], endYm: '201003' })!
    // 적립이 없으면 두 방식이 같다
    expect(run('cashflow', 0).value).toEqual(run('none', 0).value)
    // 0번째 달 새 돈 100은 비중이 목표와 같아 둘 다 50/50 → a 150·b 150, 1번째 달 a 300·b 150
    // 1번째 달 새 돈 100: cashflow는 b에 전부(a 300→600 + b 250 = 850), none은 50/50(a 350→700 + b 200 = 900)
    const cf = run('cashflow', 100)
    const none = run('none', 100)
    expect(none.stats.endValue - cf.stats.endValue).toBeCloseTo(50)
    expect(cf.stats.paidTotal).toBe(none.stats.paidTotal)
  })

  it('지수(시간가중)는 넣는 돈과 무관하다', () => {
    const a = asset('a', '2010', (i) => 100 + 10 * Math.sin(i))
    const b = asset('b', '2010', (i) => 100 + i)
    const x = simulatePlan({ weights: { a: 60, b: 40 }, lump: 1, assets: [a, b] })!
    const y = simulatePlan({ weights: { a: 60, b: 40 }, lump: 5000, monthly: 70, assets: [a, b] })!
    y.index.forEach((v, i) => expect(v).toBeCloseTo(x.index[i], 10))
  })
})

describe('rollingStarts', () => {
  it('같은 길이로 가능한 모든 시작월을 돌린다', () => {
    const a = asset('a', '2010', (i) => 100 * 1.01 ** i, 36)
    const r = rollingStarts({ weights: { a: 1 }, startYm: '201001', endYm: '201101', monthly: 10, assets: [a] })!
    expect(r.count).toBe(36 - 12)
    // 매달 같은 비율로 오르면 시작월과 무관하게 같은 배율
    expect(r.max - r.min).toBeLessThan(1e-9)
    expect(r.worsePct).toBe(0)
  })

  it('넣은 돈이 없으면 null', () => {
    const a = asset('a', '2010', () => 100)
    expect(rollingStarts({ weights: { a: 1 }, assets: [a] })).toBeNull()
  })
})

describe('annualIrr', () => {
  it('넣기만 하거나 받기만 하면 null', () => {
    expect(annualIrr([-1, -1])).toBeNull()
    expect(annualIrr([1, 1])).toBeNull()
  })
})
