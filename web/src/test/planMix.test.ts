import { describe, expect, it } from 'vitest'
import { KOSPI_HISTORY, recommendOverseas } from '../lib/accumulate'
import { OVERSEAS_ETF_CANDIDATES } from '../data/accumulateData'
import { BEGINNER_PRESET_KEY, PLAN_MIX_PRESETS, isKospiOnly, mixHistory, mixLabel, mixStats, presetCompareWindow, presetEntries, presetKeyOf, sameMix } from '../lib/planMix'

const preset = (key: string) => presetEntries(PLAN_MIX_PRESETS.find((p) => p.key === key)!)

describe('내 계획 구성', () => {
  it('프리셋은 국내만·반반·셋, 처음 권하는 건 반반이고 나스닥100 단독은 없다', () => {
    expect(PLAN_MIX_PRESETS.map((p) => p.label)).toEqual(['국내만', '국내·해외 반반', '셋 같은 비중'])
    expect(BEGINNER_PRESET_KEY).toBe('half')
    expect(PLAN_MIX_PRESETS.some((p) => Object.keys(p.weights).length === 1 && p.weights.nasdaq100)).toBe(false)
    for (const p of PLAN_MIX_PRESETS) expect(Object.values(p.weights).reduce((s, w) => s + w, 0)).toBeCloseTo(1, 9)
  })

  it('서버가 반올림해 돌려준 비중(0.3333)도 같은 프리셋으로 알아본다, 상품을 바꿔도 프리셋은 그대로', () => {
    const saved = [
      { index: 'kospi200' as const, weight: 0.3333, product: null, account: null },
      { index: 'sp500' as const, weight: 0.3333, product: { code: '360200', name: 'ACE 미국S&P500' }, account: null },
      { index: 'nasdaq100' as const, weight: 0.3334, product: null, account: null },
    ]
    expect(presetKeyOf(saved)).toBe('three')
    expect(presetKeyOf([{ index: 'kospi200', weight: 0.7, product: null, account: null }, { index: 'sp500', weight: 0.3, product: null, account: null }])).toBeNull()
    expect(sameMix(saved, preset('three'))).toBe(false) // 상품이 다르면 저장할 것이 남음
    // 프리셋을 다시 눌러도 고른 상품은 남긴다
    expect(presetEntries(PLAN_MIX_PRESETS[1], saved).find((e) => e.index === 'sp500')?.product?.code).toBe('360200')
  })

  it('국내만은 지금과 같은 코스피200 이력, 섞으면 가장 짧은 지수가 시작을 정한다', () => {
    expect(isKospiOnly(preset('kospi'))).toBe(true)
    expect(mixHistory(preset('kospi'))).toBe(KOSPI_HISTORY)
    const half = mixHistory(preset('half'))!
    expect(half.id).toBe('mix')
    expect(half.name).toBe('코스피200 50 · S&P500 50')
    expect(half.monthly[0][0]).toBe('200312')
    expect(mixHistory(preset('three'))!.monthly[0][0]).toBe('201010')
    expect(mixLabel(preset('three'))).toBe('코스피200 33 · S&P500 33 · 나스닥100 33')
  })

  it('프리셋 비교는 같은 기간으로 — 짧은 이력만 2008년을 건너뛰지 않게', () => {
    const span = presetCompareWindow()
    const stats = PLAN_MIX_PRESETS.map((p) => mixStats(presetEntries(p), span)!)
    expect(new Set(stats.map((s) => s.fromYear)).size).toBe(1)
    for (const s of stats) {
      expect(s.low).toBeLessThanOrEqual(s.typical)
      expect(s.mddPct).toBeLessThan(0)
    }
    // 국내만을 처음부터 보면 2008년이 들어가 낙폭이 더 깊다
    expect(mixStats(preset('kospi'), { until: span.until })!.mddPct).toBeLessThan(stats[0].mddPct)
  })

  it('해외지수 상품 추천은 그 지수 후보 안에서만 고른다', () => {
    const sp = recommendOverseas('sp500')
    expect(sp.pick).not.toBeNull()
    expect(sp.eligible.every((c) => OVERSEAS_ETF_CANDIDATES.find((x) => x.code === c.code)?.index === 'sp500')).toBe(true)
    expect(recommendOverseas('nasdaq100').pick?.name).toMatch(/나스닥100$/)
  })
})
