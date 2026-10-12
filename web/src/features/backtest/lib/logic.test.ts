import { describe, expect, it } from 'vitest'
import type { AutoPickItem, BacktestRiser, RuleFilter, StockIndicators } from '../types'
import { bucketAutoPicks, estimateExpectedReturnPct, evaluateAutoPick } from './autoPick'
import { buildPatternMatch } from './patternMatch'
import { filterSamplesByRule, isRuleKeyMatched, matchesRuleFilter } from './ruleMatch'
import { computeInvestSim, computeVisibleHorizons, filterFeatureStats, hasExtendedHorizon, sortRisers } from './backtestView'

const ind = (o: Partial<StockIndicators>): StockIndicators => ({
  code: 'x', name: 'x', market: null, close: null, score_date: null, total_score: null, signal: null, indicator_date: null,
  rsi14: null, sma20: null, sma50: null, sma200: null, pullback_date: null, entry_grade: null, warn_grade: null,
  dist_pct: null, per: null, pbr: null, roe: null, debt_ratio: null, market_cap: null, ...o,
})
const riser = (code: string, o: Partial<BacktestRiser>): BacktestRiser => ({
  code, asof: '2026-08-01', totalScore: 60, signal: 'WATCH', rsi14: 50, forwardReturnPct: 20, ...o,
})

describe('evaluateAutoPick', () => {
  it('RSI 이상 구간 + BUY + 점수 50+ 는 즉시 매수 후보 (점수 계산 고정)', () => {
    expect(evaluateAutoPick(ind({ total_score: 75, rsi14: 55, signal: 'BUY' }))).toEqual({ tier: 'now', coreMatchCount: 4, edgeScore: 91 })
  })
  it('경고 등급은 감점', () => {
    expect(evaluateAutoPick(ind({ total_score: 75, rsi14: 55, signal: 'BUY', warn_grade: 'WARN' }))?.edgeScore).toBe(73)
    expect(evaluateAutoPick(ind({ total_score: 75, rsi14: 55, signal: 'BUY', warn_grade: 'WATCH' }))?.edgeScore).toBe(83)
  })
  it('강한 SELL은 제외, 낮은 RSI 회복은 단계가 내려간다', () => {
    expect(evaluateAutoPick(ind({ total_score: 90, rsi14: 55, signal: 'STRONG_SELL' }))).toBeNull()
    expect(evaluateAutoPick(ind({ total_score: 40, rsi14: 32, signal: 'HOLD' }))).toEqual({ tier: 'prepare', coreMatchCount: 1, edgeScore: 7 })
    expect(evaluateAutoPick(ind({ total_score: 40, rsi14: 25, signal: 'HOLD' }))).toEqual({ tier: 'watch', coreMatchCount: 0, edgeScore: 0 })
    expect(evaluateAutoPick(ind({ total_score: 40, rsi14: 25, signal: 'SELL' }))).toBeNull()
    expect(evaluateAutoPick(ind({ total_score: 40, rsi14: null, signal: 'HOLD' }))).toBeNull()
  })
})

describe('estimateExpectedReturnPct', () => {
  it('규칙 평균을 그대로(소수 1자리) — 가산 계수 없음', () => {
    const base = { coreMatchCount: 4, ruleMatched: true, score: 90, shortMomentumPct: 5, tier: 'now' as const, profile: 'aggressive' as const }
    expect(estimateExpectedReturnPct({ ...base, baseReturnPct: 3.24 })).toBe(3.2)
    expect(estimateExpectedReturnPct({ ...base, baseReturnPct: -1.26 })).toBe(-1.3)
  })
})

describe('bucketAutoPicks', () => {
  it('단계별로 나눈다', () => {
    const mk = (tier: AutoPickItem['tier']) => ({ tier }) as AutoPickItem
    const b = bucketAutoPicks([mk('now'), mk('watch'), mk('now')])
    expect([b.now.length, b.prepare.length, b.watch.length]).toEqual([2, 0, 1])
  })
})

describe('규칙 판정', () => {
  it('matchesRuleFilter: 필터 없으면 통과, 조건별 탈락', () => {
    expect(matchesRuleFilter(ind({}), undefined)).toBe(true)
    expect(matchesRuleFilter(ind({ total_score: 60, signal: 'BUY', rsi14: 50 }), { scoreMin: 65 })).toBe(false)
    expect(matchesRuleFilter(ind({ total_score: 70, signal: 'HOLD', rsi14: 50 }), { buyOnly: true })).toBe(false)
    expect(matchesRuleFilter(ind({ total_score: 70, signal: 'BUY', rsi14: null }), { rsiMin: 40 })).toBe(false)
    expect(matchesRuleFilter(ind({ total_score: 70, signal: 'BUY', rsi14: 71 }), { rsiMax: 70 })).toBe(false)
    expect(matchesRuleFilter(ind({ total_score: 70, signal: 'BUY', rsi14: 55 }), { scoreMin: 70, buyOnly: true, rsiMin: 45, rsiMax: 65 })).toBe(true)
  })
  it('isRuleKeyMatched: 키별 조건(경계 포함)과 모르는 키', () => {
    const base = { total_score: 70, signal: 'BUY', rsi14: 45 }
    expect(isRuleKeyMatched('rule_score70_buy', base)).toBe(true)
    expect(isRuleKeyMatched('rule_score70_buy', { ...base, total_score: 69.9 })).toBe(false)
    expect(isRuleKeyMatched('rule_rsi45_65', { ...base, rsi14: 65 })).toBe(true)
    expect(isRuleKeyMatched('rule_rsi45_65', { ...base, rsi14: 65.1 })).toBe(false)
    expect(isRuleKeyMatched('rule_score70_buy_rsi45_65', base)).toBe(true)
    expect(isRuleKeyMatched('rule_rsi40_70', { ...base, rsi14: null })).toBe(false)
    expect(isRuleKeyMatched('rule_unknown', base)).toBe(false)
  })
  it('filterSamplesByRule: 조건대로 샘플을 거르고 순서를 유지', () => {
    const rows = [
      riser('a', { totalScore: 80, signal: 'BUY', rsi14: 50 }),
      riser('b', { totalScore: 60, signal: 'BUY', rsi14: 50 }),
      riser('c', { totalScore: 90, signal: 'BUY', rsi14: null }),
    ]
    expect(filterSamplesByRule(rows, { scoreMin: 70, buyOnly: true, rsiMin: 40 }).map((r) => r.code)).toEqual(['a'])
    expect(filterSamplesByRule(rows, { scoreMin: 70 }).map((r) => r.code)).toEqual(['a', 'c'])
  })
})

describe('buildPatternMatch', () => {
  it('3조건 일치 개수와 RSI 없음은 0 취급', () => {
    expect(buildPatternMatch(ind({ total_score: 72, signal: 'BUY', rsi14: 50 })).matchCount).toBe(3)
    const m = buildPatternMatch(ind({ total_score: 72, signal: 'HOLD', rsi14: null, score_date: null, indicator_date: '2026-10-01' }))
    expect(m).toMatchObject({ rsi: 0, rsiMatch: false, buyMatch: false, scoreMatch: true, matchCount: 1, dataDate: '2026-10-01' })
  })
})

describe('backtestView', () => {
  it('sortRisers: 키·방향별, 원본 보존', () => {
    const rows = [
      riser('a', { forwardReturnPct: 10, totalScore: 70, rsi14: null, asof: '2026-08-02' }),
      riser('b', { forwardReturnPct: 30, totalScore: 50, rsi14: 60, asof: '2026-08-01' }),
    ]
    expect(sortRisers(rows, 'forwardReturnPct', 'desc').map((r) => r.code)).toEqual(['b', 'a'])
    expect(sortRisers(rows, 'totalScore', 'asc').map((r) => r.code)).toEqual(['b', 'a'])
    expect(sortRisers(rows, 'rsi14', 'asc').map((r) => r.code)).toEqual(['a', 'b'])
    expect(sortRisers(rows, 'asof', 'asc').map((r) => r.code)).toEqual(['b', 'a'])
    expect(rows[0].code).toBe('a')
  })
  it('Horizon 노출: 기본 20·40·60 + 데이터 있는 90·120 + 선택값', () => {
    expect(computeVisibleHorizons(undefined, 20)).toEqual([20, 40, 60])
    expect(computeVisibleHorizons([90], 20)).toEqual([20, 40, 60, 90])
    expect(computeVisibleHorizons([], 120)).toEqual([20, 40, 60, 120])
    expect(hasExtendedHorizon([120])).toBe(true)
    expect(hasExtendedHorizon([20, 40])).toBe(false)
  })
  it('특징 통계: 작은 표본(5건 미만)은 기본 숨김', () => {
    const row = (key: string, riserMatches: number) => ({
      key, label: key, baselineMatches: 10, baselineRatePct: 0, riserMatches, riserRatePct: 0, liftPct: 0, supportPct: 0,
    })
    const rows = [row('a', 5), row('b', 4)]
    expect(filterFeatureStats(rows, false).map((r) => r.key)).toEqual(['a'])
    expect(filterFeatureStats(rows, true)).toHaveLength(2)
  })
  it('투자 시뮬레이션: 금액 0 이하는 null, 패턴 수익 없으면 gain도 null', () => {
    expect(computeInvestSim({ baselineAvgReturnPct: 2, investAmount: 0, patternReturnPct: null })).toBeNull()
    expect(computeInvestSim({ baselineAvgReturnPct: 2, investAmount: 1_000_000, patternReturnPct: null })).toEqual({
      avgGain: 20000, avgReturn: 2, patternReturn: null, patternGain: null,
    })
    expect(computeInvestSim({ baselineAvgReturnPct: undefined, investAmount: 1_000_000, patternReturnPct: -3 })?.patternGain).toBe(-30000)
  })
})

// handlers/ui/backtest-risers.ts 의 규칙 정의(key → filter) 사본. 서버가 바뀌면 이 표와 isRuleKeyMatched를 함께 고친다.
const SERVER_RULE_FILTERS: Record<string, RuleFilter> = {
  rule_score70_buy: { scoreMin: 70, buyOnly: true },
  rule_score65_buy: { scoreMin: 65, buyOnly: true },
  rule_score60_buy: { scoreMin: 60, buyOnly: true },
  rule_score55_buy: { scoreMin: 55, buyOnly: true },
  rule_rsi30_80: { rsiMin: 30, rsiMax: 80 },
  rule_rsi40_70: { rsiMin: 40, rsiMax: 70 },
  rule_rsi45_65: { rsiMin: 45, rsiMax: 65 },
  rule_score60_rsi40_70: { scoreMin: 60, rsiMin: 40, rsiMax: 70 },
  rule_score55_rsi40_70: { scoreMin: 55, rsiMin: 40, rsiMax: 70 },
  rule_buy_rsi45_65: { buyOnly: true, rsiMin: 45, rsiMax: 65 },
  rule_buy_rsi40_70: { buyOnly: true, rsiMin: 40, rsiMax: 70 },
  rule_score65_buy_rsi40_70: { scoreMin: 65, buyOnly: true, rsiMin: 40, rsiMax: 70 },
  rule_score70_buy_rsi45_65: { scoreMin: 70, buyOnly: true, rsiMin: 45, rsiMax: 65 },
}

describe('규칙 키 매칭과 서버 필터의 동등성', () => {
  it('13개 규칙 모두 점수·신호·RSI 격자에서 같은 결과', () => {
    for (const [key, filter] of Object.entries(SERVER_RULE_FILTERS)) {
      for (const total_score of [0, 54.9, 55, 59.9, 60, 64.9, 65, 69.9, 70, 90]) {
        for (const signal of ['BUY', 'HOLD', 'SELL', null]) {
          for (const rsi14 of [null, 29, 30, 39.9, 40, 44.9, 45, 65, 65.1, 70, 70.1, 80, 80.1]) {
            const i = ind({ total_score, signal, rsi14 })
            expect(isRuleKeyMatched(key, i), `${key} ${total_score} ${signal} ${rsi14}`).toBe(matchesRuleFilter(i, filter))
          }
        }
      }
    }
  })
})
