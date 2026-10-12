import { describe, expect, it } from 'vitest'
import type { ScanCandidate } from '../types'
import { clampScanValue, computePriorityScore, computeQuickTradeScore, getEntryLevel, gradeScore, normalizeScanScoreToPct } from './candidateScore'
import { isBuycheckStage, isCandidateStage, isConfirmStage, isDayStrategyCandidate, isOvernightStrategyCandidate, isQuickTradeCandidate, isQuickTradeLiteCandidate, isWeeklyStrategyCandidate } from './candidateStage'
import { toComparableValue } from './sorting'
import { getStrategyRiskTier, getTierAdjustedPosition } from './strategyRisk'

const cand = (patch: Partial<ScanCandidate> = {}): ScanCandidate => ({
  code: '000000',
  name: '테스트',
  sector_id: null,
  liquidity: null,
  trade_date: null,
  stock_updated_at: null,
  entry_grade: null,
  entry_score: null,
  trend_grade: null,
  dist_grade: null,
  dist_pct: null,
  pivot_grade: null,
  vol_atr_grade: null,
  warn_grade: null,
  warn_score: null,
  ...patch,
})

/** 진입 A·추세 A·이격 B·저점 B·안전·경고 0 → 눌림목 점수 81(breakout)인 튼튼한 후보. 유동성 50억, 장중 +1.8% */
const strong = (patch: Partial<ScanCandidate> = {}) => cand({
  entry_grade: 'A', trend_grade: 'A', dist_grade: 'B', pivot_grade: 'B', warn_grade: 'SAFE',
  entry_score: 3, warn_score: 0, dist_pct: 3, liquidity: 5_000_000_000, intraday_change_pct: 1.8,
  ...patch,
})

describe('등급·점수 기본 함수', () => {
  it('gradeScore: A5 B4 C3 D2 E1, 모르는 값 0, 빈 값 -1', () => {
    expect(['A', 'B', 'C', 'D', 'E', ' b ', 'X'].map(gradeScore)).toEqual([5, 4, 3, 2, 1, 4, 0])
    expect(gradeScore(null)).toBe(-1)
    expect(gradeScore(undefined)).toBe(-1)
  })
  it('getEntryLevel: A·B 외에는 c', () => {
    expect(['A', 'b', 'C', null, ''].map(getEntryLevel)).toEqual(['a', 'b', 'c', 'c', 'c'])
  })
  it('clampScanValue: 범위로 자르고, 유한하지 않은 값은 최솟값', () => {
    expect(clampScanValue(150, 0, 100)).toBe(100)
    expect(clampScanValue(-3, 0, 100)).toBe(0)
    expect(clampScanValue(NaN, 5, 100)).toBe(5)
    expect(clampScanValue(Infinity, 5, 100)).toBe(5)
  })
  it('normalizeScanScoreToPct: 5 이하는 5점 만점으로 보고 ×20, 5 초과는 이미 퍼센트', () => {
    expect(normalizeScanScoreToPct(3)).toBe(60)
    expect(normalizeScanScoreToPct(80)).toBe(80)
    expect(normalizeScanScoreToPct(120)).toBe(100)
    expect(normalizeScanScoreToPct(-1)).toBe(0)
    expect(normalizeScanScoreToPct(null)).toBe(0)
    expect(normalizeScanScoreToPct(undefined)).toBe(0)
  })
})

describe('computePriorityScore', () => {
  it('진입점수×20 − 경고점수×3', () => {
    expect(computePriorityScore(cand({ entry_score: 3, warn_score: 2 }))).toBe(54)
    expect(computePriorityScore(cand({ entry_score: 1, warn_score: 5 }))).toBe(5)
  })
  it('값이 없으면 0으로 계산', () => {
    expect(computePriorityScore(cand())).toBe(0)
  })
  it('적응 점수(adaptive_score)가 있으면 그 값을 쓴다', () => {
    expect(computePriorityScore(cand({ entry_score: 3, warn_score: 0, adaptive_score: 42 }))).toBe(42)
  })
  it('적응 점수가 유한하지 않으면 무시', () => {
    expect(computePriorityScore(cand({ entry_score: 3, adaptive_score: NaN }))).toBe(60)
  })
})

describe('퀵트레이드 점수와 판정', () => {
  it('computeQuickTradeScore: 진입·안전·유동성·장중 변동 가중 합 (기본 후보 70.8)', () => {
    // 진입 60%×0.46 + 안전 100×0.16 + 유동성(50억→55)×0.24 + 장중 적합(+1.8%→100)×0.14
    expect(computeQuickTradeScore(strong())).toBeCloseTo(70.8, 6)
  })
  it('유동성이 클수록 점수가 오른다', () => {
    const low = computeQuickTradeScore(strong({ liquidity: 1_000_000_000 }))
    const high = computeQuickTradeScore(strong({ liquidity: 100_000_000_000 }))
    expect(high).toBeGreaterThan(low)
    expect(high).toBeCloseTo(60 * 0.46 + 100 * 0.16 + 100 * 0.24 + 100 * 0.14, 6)
  })
  it('엄격 퀵트레이드: 기본 후보는 통과', () => {
    expect(isQuickTradeCandidate(strong())).toBe(true)
  })
  it('엄격: 경고 SELL, 등급 미달, 유동성 10억 미만이면 탈락', () => {
    expect(isQuickTradeCandidate(strong({ warn_grade: 'SELL' }))).toBe(false)
    expect(isQuickTradeCandidate(strong({ entry_grade: 'C', trend_grade: 'C' }))).toBe(false)
    expect(isQuickTradeCandidate(strong({ liquidity: 900_000_000 }))).toBe(false)
  })
  it('엄격: 장중 변동 -3.5%~+8.5% 밖이면 탈락, 경계는 통과(점수 기준을 넘도록 유동성을 크게)', () => {
    const big = { liquidity: 100_000_000_000 }
    expect(isQuickTradeCandidate(strong({ ...big, intraday_change_pct: 8.5 }))).toBe(true)
    expect(isQuickTradeCandidate(strong({ ...big, intraday_change_pct: 9 }))).toBe(false)
    expect(isQuickTradeCandidate(strong({ ...big, intraday_change_pct: -3.5 }))).toBe(true)
    expect(isQuickTradeCandidate(strong({ ...big, intraday_change_pct: -4 }))).toBe(false)
  })
  it('엄격: 변동이 경계 가까이면 점수(58)에서 먼저 탈락한다', () => {
    expect(computeQuickTradeScore(strong({ intraday_change_pct: 8.5 }))).toBeLessThan(58)
    expect(isQuickTradeCandidate(strong({ intraday_change_pct: 8.5 }))).toBe(false)
  })
  it('라이트는 변동 -5.5%~+10.5%, 유동성 30억 이상까지 허용', () => {
    expect(isQuickTradeLiteCandidate(strong({ intraday_change_pct: 10 }))).toBe(true)
    expect(isQuickTradeLiteCandidate(strong({ intraday_change_pct: 11 }))).toBe(false)
    expect(isQuickTradeLiteCandidate(strong({ intraday_change_pct: 9 }))).toBe(true)
    expect(isQuickTradeCandidate(strong({ intraday_change_pct: 9 }))).toBe(false)
  })
  it('유동성 20억은 엄격만 통과하고 라이트는 탈락(30억 미만)', () => {
    const c = strong({ liquidity: 2_000_000_000 })
    expect(computeQuickTradeScore(c)).toBeCloseTo(67.2, 6)
    expect(isQuickTradeCandidate(c)).toBe(true)
    expect(isQuickTradeLiteCandidate(c)).toBe(false)
  })
})

describe('전략 후보 판정', () => {
  it('데이: 라이트 통과 + 경고 WARN/SELL 아님 + 변동 -1.5%~+4.5%', () => {
    expect(isDayStrategyCandidate(strong())).toBe(true)
    expect(isDayStrategyCandidate(strong({ warn_grade: 'WARN' }))).toBe(false)
    expect(isDayStrategyCandidate(strong({ intraday_change_pct: 5 }))).toBe(false)
    expect(isQuickTradeLiteCandidate(strong({ intraday_change_pct: 5 }))).toBe(true)
    expect(isDayStrategyCandidate(strong({ intraday_change_pct: 4.5 }))).toBe(true)
    expect(isDayStrategyCandidate(strong({ intraday_change_pct: -1.6 }))).toBe(false)
  })
  it('오버나이트: 라이트 신호가 0~2일 전이어야 하고 경고 WARN이면 탈락', () => {
    expect(isOvernightStrategyCandidate(strong(), { strictAgeDays: null, quickLiteAgeDays: 1 })).toBe(true)
    expect(isOvernightStrategyCandidate(strong(), { strictAgeDays: null, quickLiteAgeDays: 0 })).toBe(true)
    expect(isOvernightStrategyCandidate(strong(), { strictAgeDays: null, quickLiteAgeDays: 3 })).toBe(false)
    expect(isOvernightStrategyCandidate(strong(), { strictAgeDays: null, quickLiteAgeDays: null })).toBe(false)
    expect(isOvernightStrategyCandidate(strong())).toBe(false)
    expect(isOvernightStrategyCandidate(strong({ warn_grade: 'WARN' }), { strictAgeDays: null, quickLiteAgeDays: 1 })).toBe(false)
    expect(isOvernightStrategyCandidate(strong({ liquidity: 500_000_000 }), { strictAgeDays: null, quickLiteAgeDays: 1 })).toBe(false)
  })
  it('주간: 눌림목 점수가 충분하고 저점이 A~C, 장중 변동 ±6.5% 이내', () => {
    expect(isWeeklyStrategyCandidate(strong())).toBe(true)
    expect(isWeeklyStrategyCandidate(strong({ pivot_grade: 'D' }))).toBe(false)
    expect(isWeeklyStrategyCandidate(strong({ intraday_change_pct: 7 }))).toBe(false)
    expect(isWeeklyStrategyCandidate(strong({ warn_grade: 'SELL' }))).toBe(false)
  })
  it('주간: 진입·추세 둘 다 A/B가 아니면 탈락, 눌림목 점수가 낮아도 탈락', () => {
    expect(isWeeklyStrategyCandidate(strong({ entry_grade: 'C', trend_grade: 'C' }))).toBe(false)
    expect(isWeeklyStrategyCandidate(cand({ entry_grade: 'A', warn_grade: 'WARN' }))).toBe(false)
  })
})

describe('후보 → 확인 → 매수검토 단계', () => {
  it('후보: 이격·저점 A/B면 통과, SELL이면 탈락', () => {
    expect(isCandidateStage(cand({ dist_grade: 'A' }))).toBe(true)
    expect(isCandidateStage(cand({ pivot_grade: 'B' }))).toBe(true)
    expect(isCandidateStage(cand({ dist_grade: 'A', warn_grade: 'SELL' }))).toBe(false)
    expect(isCandidateStage(cand({ dist_grade: 'C', pivot_grade: 'C', warn_grade: 'WARN' }))).toBe(false)
  })
  it('후보: A/B가 없어도 눌림목 점수가 55 이상이면 통과', () => {
    // 이격C 10 + 저점C 10 + 추세C 8 + 안전 12 + 경고0 8 + 이격률3 10 = 58
    expect(isCandidateStage(cand({ dist_grade: 'C', pivot_grade: 'C', trend_grade: 'C', warn_grade: 'SAFE', warn_score: 0, dist_pct: 3 }))).toBe(true)
  })
  it('확인: 후보이면서 진입 A/B이거나 추세·저점이 돌아섰을 때', () => {
    expect(isConfirmStage(cand({ dist_grade: 'A', entry_grade: 'C', trend_grade: 'C', pivot_grade: 'C' }))).toBe(false)
    expect(isConfirmStage(cand({ dist_grade: 'A', entry_grade: 'B' }))).toBe(true)
    expect(isConfirmStage(cand({ dist_grade: 'A', trend_grade: 'B' }))).toBe(true)
    expect(isConfirmStage(cand({ entry_grade: 'A' }))).toBe(false)
  })
  it('매수검토: 확인 + 경고 없음/SAFE/WATCH + (우선순위 55 이상 또는 퀵라이트)', () => {
    const ok = cand({ dist_grade: 'A', entry_grade: 'A', warn_grade: 'SAFE', entry_score: 3, warn_score: 0 })
    expect(isBuycheckStage(ok)).toBe(true)
    expect(isBuycheckStage({ ...ok, warn_grade: 'WARN' })).toBe(false)
    expect(isBuycheckStage({ ...ok, warn_grade: '' })).toBe(true)
    expect(isBuycheckStage({ ...ok, entry_score: 1 })).toBe(false)
    expect(isBuycheckStage({ ...ok, entry_score: 1, adaptive_score: 70 })).toBe(true)
  })
  it('매수검토: 우선순위가 낮아도 퀵라이트면 통과', () => {
    const c = strong({ entry_score: 2.9 }) // 우선순위 58 → 퀵라이트 여부로 가려내려면 낮춰야 하므로 아래에서 확인
    expect(isBuycheckStage(c)).toBe(true)
    const low = strong({ entry_score: 1, adaptive_score: 10 })
    expect(computePriorityScore(low)).toBe(10)
    expect(isQuickTradeLiteCandidate(low)).toBe(computeQuickTradeScore(low) >= 52)
    expect(isBuycheckStage(low)).toBe(isQuickTradeLiteCandidate(low))
  })
})

describe('toComparableValue', () => {
  const c = strong({ code: '005930', name: '삼성전자', sector_id: '반도체', entry_grade: 'B', trend_grade: null })
  it('우선순위·눌림목 점수는 계산값', () => {
    expect(toComparableValue(c, 'priority_score')).toBe(60)
    expect(typeof toComparableValue(c, 'lead_accumulation_score')).toBe('number')
  })
  it('등급 열은 등급 점수로 비교', () => {
    expect(toComparableValue(c, 'entry_grade')).toBe(4)
    expect(toComparableValue(c, 'trend_grade')).toBe(-1)
  })
  it('나머지는 원래 값: 숫자는 숫자, 문자열은 문자열, 없으면 빈 문자열', () => {
    expect(toComparableValue(c, 'name')).toBe('삼성전자')
    expect(toComparableValue(c, 'liquidity')).toBe(5_000_000_000)
    expect(toComparableValue(cand(), 'sector_id')).toBe('')
  })
})

describe('전략 위험 단계', () => {
  it('상태 문구에서 단계를 읽는다(경고 > 주의 > 양호)', () => {
    expect(getStrategyRiskTier('표본 경고')).toBe('warning')
    expect(getStrategyRiskTier('수익률 주의')).toBe('caution')
    expect(getStrategyRiskTier('주의·경고')).toBe('warning')
    expect(getStrategyRiskTier('양호')).toBe('good')
    expect(getStrategyRiskTier(undefined)).toBe('good')
  })
  it('단계별 권장 비중(R)을 줄인다: 경고 ×0.5(최소 0.2), 주의 ×0.7(최소 0.3)', () => {
    expect(getTierAdjustedPosition(1.0, 'good')).toBe(1)
    expect(getTierAdjustedPosition(0.7, 'good')).toBe(0.7)
    expect(getTierAdjustedPosition(1.0, 'caution')).toBe(0.7)
    expect(getTierAdjustedPosition(1.0, 'warning')).toBe(0.5)
    expect(getTierAdjustedPosition(0.5, 'warning')).toBeGreaterThanOrEqual(0.2)
    expect(getTierAdjustedPosition(0.5, 'caution')).toBeGreaterThanOrEqual(0.3)
  })
})
