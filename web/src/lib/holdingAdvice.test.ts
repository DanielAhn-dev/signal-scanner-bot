import { describe, expect, it } from 'vitest'
import { adviseHoldings } from './holdingAdvice'

const cost = () => 0.25
const h = (code: string, qty: number, avg: number, cur: number) => ({ code, name: code, quantity: qty, avgPrice: avg, currentPrice: cur })

describe('adviseHoldings', () => {
  it('보유가 없으면 조언도 없다', () => {
    expect(adviseHoldings({ holdings: [], level: 'safe', sellCostPct: cost })).toEqual([])
  })
  it('지수 ETF는 그대로 보유', () => {
    const [a] = adviseHoldings({ holdings: [h('069500', 10, 30000, 35000)], level: 'safe', sellCostPct: cost })
    expect(a.action).toBe('keep')
  })
  it('한도를 넘는 종목은 초과분만 줄이라고 알려준다', () => {
    const r = adviseHoldings({ holdings: [h('005930', 10, 50000, 60000), h('069500', 100, 30000, 30000)], level: 'balanced', sellCostPct: cost })
    const s = r.find((x) => x.code === '005930')!
    expect(s.action).toBe('trim')
    expect(s.trimAmount).toBeGreaterThan(0)
    expect(s.trimAmount).toBeLessThan(600_000)
  })
  it('크게 물린 종목은 팔라고 재촉하지 않는다', () => {
    const r = adviseHoldings({ holdings: [h('000660', 1, 100000, 80000), h('069500', 100, 30000, 30000)], level: 'balanced', sellCostPct: cost })
    expect(r.find((x) => x.code === '000660')!.action).toBe('redirect')
  })
  it('평단·현재가가 없는 행은 건너뛴다', () => {
    expect(adviseHoldings({ holdings: [h('005930', 10, 0, 60000)], level: 'safe', sellCostPct: cost })).toEqual([])
  })
})
