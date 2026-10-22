import { describe, expect, it } from 'vitest'
import { MIX_ASSETS } from '../../data/mixData'
import { SIM_ASOF, SIM_ASSETS } from '../../data/simData'
import { simulateMix } from '../mix'
import { commonMonths, simulatePlan } from './engine'

const nextYm = (ym: string) => {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(4))
  return m === 12 ? `${y + 1}01` : `${y}${String(m + 1).padStart(2, '0')}`
}

describe('simData (scripts/research/build_sim_data.py 생성)', () => {
  it('자산마다 달이 빠짐없이 이어지고 값이 양수', () => {
    for (const a of SIM_ASSETS) {
      expect(a.monthly[0][0]).toBe(a.first)
      expect(a.monthly.at(-1)![0]).toBe(a.last)
      a.monthly.forEach(([ym, v], i) => {
        expect(v).toBeGreaterThan(0)
        if (i > 0) expect(ym).toBe(nextYm(a.monthly[i - 1][0]))
      })
    }
  })

  it('id가 겹치지 않고 SIM_ASOF는 가장 최근 달', () => {
    expect(new Set(SIM_ASSETS.map((a) => a.id)).size).toBe(SIM_ASSETS.length)
    expect(SIM_ASOF.replace('-', '')).toBe(SIM_ASSETS.map((a) => a.last).sort().at(-1))
  })

  it('섞어보기 자산은 섞어보기 기간에 월 수익률이 같다(앞으로만 늘렸다)', () => {
    for (const m of MIX_ASSETS) {
      const s = SIM_ASSETS.find((a) => a.id === m.id)!
      expect(s, m.id).toBeTruthy()
      expect(s.dragPct).toBe(m.dragPct)
      expect(s.first <= m.first).toBe(true)
      const sim = new Map(s.monthly)
      for (let i = 1; i < m.monthly.length; i += 1) {
        const [ym, v] = m.monthly[i]
        const [py, pv] = m.monthly[i - 1]
        expect(sim.get(ym)! / sim.get(py)!).toBeCloseTo(v / pv, 6)
      }
    }
  })

  it('섞어보기 기간으로 자르면 엔진 결과가 섞어보기와 같다', () => {
    const weights = { kospi200: 30, nasdaq100: 30, kbond10: 25, gold: 15 }
    const mix = simulateMix(weights, 'year')!
    const r = simulatePlan({ weights, rebalance: 'year', lump: 1, startYm: commonMonths(weights, MIX_ASSETS)[0], endYm: mix.to, assets: SIM_ASSETS })!
    r.value.forEach((v, i) => expect(v).toBeCloseTo(mix.curve[i], 6))
  })

  it('새 자산·늘린 이력으로 엔진이 돈다 (S&P500은 1996년부터)', () => {
    expect(commonMonths({ sp500: 1 }, SIM_ASSETS)[0]).toBe('199601')
    const r = simulatePlan({ weights: { sp500: 40, developed: 20, usbond7: 20, cash: 20 }, monthly: 50, assets: SIM_ASSETS })!
    // 가장 늦게 시작하는 IEF(2002-07)가 시작을 정한다
    expect(r.labels[0]).toBe('200207')
    expect(r.stats.paidTotal).toBe(50 * r.months)
    expect(r.stats.endValue).toBeGreaterThan(0)
  })
})
