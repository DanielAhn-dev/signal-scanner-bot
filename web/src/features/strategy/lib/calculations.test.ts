import { describe, expect, it } from 'vitest'
import type { ActivityRow, DecisionRow } from '../types'
import { summarizeDecisions } from './decisionSummary'
import { buildGrowthTimeline } from './growthTimeline'
import { buildProfitTrend } from './profitTrend'
import { buildRollingWinRate } from './rollingWinRate'
import { sortPreRallyPatterns } from './preRally'

const sell = (id: string, pnl: number, day: number): ActivityRow => ({
  id, code: id, side: 'SELL', pnl_amount: pnl, created_at: `2026-10-${String(day).padStart(2, '0')}T01:00:00Z`,
})

describe('summarizeDecisions', () => {
  it('건수·자동 비율·상위 항목 집계', () => {
    const rows: DecisionRow[] = [
      { action: 'buy', is_auto: true, trigger_label: 'new-buy', strategy_version: 'v1', market_regime: 'bull' },
      { action: 'SELL', is_auto: true, trigger_label: 'stop-loss', strategy_version: 'v1', market_regime: 'bull' },
      { action: 'SELL', is_auto: false, trigger_label: 'stop-loss', strategy_version: 'v2', market_regime: 'bear' },
    ]
    const s = summarizeDecisions(rows)
    expect(s).toMatchObject({ total: 3, autoCount: 2, buyCount: 1, sellCount: 2, autoRatio: 67 })
    expect(s.topTriggers[0]).toEqual(['stop-loss', 2])
    expect(s.topVersions[0]).toEqual(['v1', 2])
    expect(summarizeDecisions([]).autoRatio).toBe(0)
  })
})

describe('buildGrowthTimeline', () => {
  it('버전·국면이 바뀔 때만 이벤트를 만들고 30개로 자른다', () => {
    const rows: DecisionRow[] = [
      { id: 1, code: 'A', action: 'BUY', strategy_version: 'v1', market_regime: 'bull', created_at: '2026-10-01T00:00:00Z' },
      { id: 2, code: 'B', action: 'SELL', strategy_version: 'v1', market_regime: 'bull', created_at: '2026-10-02T00:00:00Z' },
      { id: 3, code: 'C', action: 'SELL', strategy_version: 'v2', market_regime: 'bear', trigger_label: 'stop-loss', created_at: '2026-10-03T00:00:00Z' },
    ]
    const ev = buildGrowthTimeline(rows)
    expect(ev.map((e) => e.text)).toEqual([
      '전략 버전 전환 → v1', '시장 국면 전환 → 상승장', '전략 버전 전환 → v2', '시장 국면 전환 → 하락장',
    ])
    expect(ev[3].subtitle).toBe('C · SELL · 손절 매도')
    const many = Array.from({ length: 50 }, (_, i) => ({ id: i, strategy_version: `v${i}` }))
    expect(buildGrowthTimeline(many)).toHaveLength(30)
  })
})

describe('buildProfitTrend', () => {
  it('실현 손익이 없으면 빈 구조', () => {
    const t = buildProfitTrend([{ id: 'b', code: 'B', side: 'BUY', created_at: '2026-10-01T00:00:00Z' }])
    expect(t.points).toEqual([])
    expect(t.baselineY).toBe(84)
    expect(t.lastValue).toBe(0)
  })
  it('날짜순 누적·막대·예상선', () => {
    const t = buildProfitTrend([sell('c', -50, 3), sell('a', 100, 1), sell('b', 30, 2)])
    expect(t.points.map((p) => p.value)).toEqual([100, 130, 80])
    expect(t.lastValue).toBe(80)
    expect(t.segments).toHaveLength(2)
    expect(t.projectionPoints).toHaveLength(3)
    expect(t.tradeBars.map((b) => b.isPositive)).toEqual([true, true, false])
    expect(t.path.startsWith('M ')).toBe(true)
  })
})

describe('buildRollingWinRate', () => {
  it('3건 미만이면 비어 있고, 이후 이동 승률', () => {
    expect(buildRollingWinRate([sell('a', 1, 1), sell('b', 1, 2)]).points).toEqual([])
    const r = buildRollingWinRate([sell('a', 1, 1), sell('b', -1, 2), sell('c', 1, 3), sell('d', 1, 4)])
    expect(r.points.map((p) => p.winRate)).toEqual([50, 50, 100].slice(0, r.points.length))
    expect(r.avgWinRate).toBeGreaterThan(0)
  })
})

describe('sortPreRallyPatterns', () => {
  it('키별 내림차순이며 원본은 보존', () => {
    const base = { name: '', avgMaxDrawdownPct: 0 }
    const src = [
      { ...base, name: 'a', samples: 5, winRatePct: 40, liftVsBasePct: 1, avgForwardReturnPct: 3 },
      { ...base, name: 'b', samples: 9, winRatePct: 30, liftVsBasePct: 4, avgForwardReturnPct: 1 },
    ]
    expect(sortPreRallyPatterns(src, 'lift')[0].name).toBe('b')
    expect(sortPreRallyPatterns(src, 'win')[0].name).toBe('a')
    expect(sortPreRallyPatterns(src, 'ret')[0].name).toBe('a')
    expect(sortPreRallyPatterns(src, 'samples')[0].name).toBe('b')
    expect(src[0].name).toBe('a')
  })
})
