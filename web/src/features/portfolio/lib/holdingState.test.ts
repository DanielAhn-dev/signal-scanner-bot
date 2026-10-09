import { describe, expect, it } from 'vitest'
import { computeMacroRisk } from './macroRisk'
import { clampRuleSettings, applyMacroToRules, resolveAdvisoryThresholds } from './thresholds'
import { evaluateHoldingState, getPerformanceGrade, type HoldingStateContext } from './holdingState'
import type { AccountPolicy } from '../types'

const DEFAULT_RULES = clampRuleSettings({
  gradeAThreshold: 80,
  gradeBThreshold: 65,
  addEntryMinScore: 70,
  partialTakeProfitPct: 8,
  partialWarnScoreMin: 3,
})

function makeCtx(opts: { macroSnapshot?: any; policy?: AccountPolicy | null } = {}): HoldingStateContext {
  const macro = computeMacroRisk(opts.macroSnapshot ?? null)
  const base = applyMacroToRules(DEFAULT_RULES, macro)
  return { rules: DEFAULT_RULES, thresholdsFor: () => resolveAdvisoryThresholds(base, opts.policy ?? null) }
}

const policy = (patch: Partial<AccountPolicy>): AccountPolicy => ({
  broker_name: '키움',
  account_name: '일반',
  risk_profile: 'balanced',
  max_positions: null,
  daily_loss_limit_pct: null,
  min_cash_reserve_pct: null,
  add_entry_score_adjust: 0,
  partial_take_profit_adjust_pct: 0,
  stop_loss_pct: null,
  take_profit_pct: null,
  ...patch,
})

describe('computeMacroRisk', () => {
  it('스냅샷이 없으면 중립', () => {
    const m = computeMacroRisk(null)
    expect(m).toMatchObject({ label: '중립', addScorePenalty: 0, partialTakeProfitBonus: 0, us10y: null, wtiOil: null, cpiYoy: null })
    expect(m.diagnosis).toBe('시장 진단 없음')
  })
  it('위험 점수 60 이상이면 주의', () => {
    expect(computeMacroRisk({ diagnosis: { riskScore: 60 } })).toMatchObject({ label: '주의', addScorePenalty: 4, partialTakeProfitBonus: 1 })
  })
  it('위험 점수 75 이상이면 방어', () => {
    expect(computeMacroRisk({ diagnosis: { riskScore: 75 } })).toMatchObject({ label: '방어', addScorePenalty: 8, partialTakeProfitBonus: 2 })
  })
  it('금리·유가·물가 중 하나만 넘어도 단계가 오른다', () => {
    expect(computeMacroRisk({ indices: { us10y: { price: 4.6 } } }).label).toBe('주의')
    expect(computeMacroRisk({ indices: { wtiOil: { price: 95 } } }).label).toBe('방어')
    expect(computeMacroRisk({ cpi: { yoy: 3.5 } }).label).toBe('방어')
  })
})

describe('clampRuleSettings / applyMacroToRules', () => {
  it('0·빈 값은 기본값으로 대체', () => {
    expect(clampRuleSettings({ gradeAThreshold: 0, gradeBThreshold: 0, addEntryMinScore: 0, partialTakeProfitPct: 0, partialWarnScoreMin: 0 }))
      .toEqual({ gradeAThreshold: 80, gradeBThreshold: 65, addEntryMinScore: 70, partialTakeProfitPct: 8, partialWarnScoreMin: 3 })
  })
  it('B 기준은 A 기준보다 낮게 보정', () => {
    const r = clampRuleSettings({ ...DEFAULT_RULES, gradeAThreshold: 50, gradeBThreshold: 90 })
    expect(r.gradeAThreshold).toBe(50)
    expect(r.gradeBThreshold).toBe(49)
  })
  it('허용 범위를 넘으면 잘라낸다', () => {
    const r = clampRuleSettings({ gradeAThreshold: 500, gradeBThreshold: 65, addEntryMinScore: 500, partialTakeProfitPct: 500, partialWarnScoreMin: 500 })
    expect(r).toMatchObject({ gradeAThreshold: 100, addEntryMinScore: 100, partialTakeProfitPct: 50, partialWarnScoreMin: 10 })
  })
  it('방어 국면은 추가매수 기준을 올리고 익절 기준을 낮춘다', () => {
    const base = applyMacroToRules(DEFAULT_RULES, computeMacroRisk({ diagnosis: { riskScore: 80 } }))
    expect(base).toEqual({ addEntryMinScore: 78, partialTakeProfitPct: 6 })
  })
  it('계좌정책 가감은 매크로 보정 위에 얹힌다', () => {
    const base = applyMacroToRules(DEFAULT_RULES, computeMacroRisk({ diagnosis: { riskScore: 60 } }))
    const t = resolveAdvisoryThresholds(base, policy({ add_entry_score_adjust: 5, partial_take_profit_adjust_pct: -2 }))
    expect(t.addEntry).toBe(79)
    expect(t.partialTp).toBe(5)
  })
})

describe('evaluateHoldingState', () => {
  const partialRow = { unrealized_pct: 10, score_signal: 'SELL', warn_score: 4 }

  it('수익률·신호·경고점수를 모두 채우면 부분청산', () => {
    const r = evaluateHoldingState(partialRow, makeCtx())
    expect(r.state).toBe('partial')
    expect(r.reasons[0]).toContain('수익률 10')
  })
  it('경고점수가 기준 미만이면 부분청산이 아니다', () => {
    expect(evaluateHoldingState({ ...partialRow, warn_score: 2 }, makeCtx()).state).toBe('hold')
  })
  it('수익률이 기준 미만이면 부분청산이 아니다', () => {
    expect(evaluateHoldingState({ ...partialRow, unrealized_pct: 7 }, makeCtx()).state).toBe('hold')
  })
  it('방어 국면에서는 더 낮은 수익률에서도 부분청산', () => {
    const ctx = makeCtx({ macroSnapshot: { diagnosis: { riskScore: 80 } } })
    expect(evaluateHoldingState({ ...partialRow, unrealized_pct: 6.5 }, ctx).state).toBe('partial')
  })
  it('계좌정책이 있으면 사유에 계좌가 표시된다', () => {
    const r = evaluateHoldingState(partialRow, makeCtx({ policy: policy({}) }))
    expect(r.reasons.some((x) => x.includes('계좌정책 반영(키움 / 일반)'))).toBe(true)
  })
  it('경고 세부 사유가 붙는다', () => {
    const r = evaluateHoldingState({ ...partialRow, warn_ma_break: true }, makeCtx())
    expect(r.reasons.some((x) => x.startsWith('상세 경고:') && x.includes('21일선 이탈'))).toBe(true)
  })

  const addRow = { recommended_buy_qty: 3, total_score: 75, entry_grade: 'A', trend_grade: 'B', warn_grade: 'SAFE', score_signal: 'BUY' }

  it('추가매수 제안·점수·등급이 맞으면 추가매수', () => {
    const r = evaluateHoldingState(addRow, makeCtx())
    expect(r.state).toBe('add')
    expect(r.reasons[0]).toBe('추가매수 제안 수량 3주')
  })
  it('점수가 기준 미만이면 추가매수가 아니다', () => {
    expect(evaluateHoldingState({ ...addRow, total_score: 69 }, makeCtx()).state).toBe('hold')
  })
  it('점수가 없으면 점수 조건은 통과한다', () => {
    expect(evaluateHoldingState({ ...addRow, total_score: undefined }, makeCtx()).state).toBe('add')
  })
  it('방어 국면에서는 추가매수 기준이 올라간다', () => {
    const ctx = makeCtx({ macroSnapshot: { diagnosis: { riskScore: 80 } } })
    expect(evaluateHoldingState({ ...addRow, total_score: 75 }, ctx).state).toBe('hold')
  })
  it('진입·추세 등급이 C이면 추가매수가 아니다', () => {
    expect(evaluateHoldingState({ ...addRow, entry_grade: 'C' }, makeCtx()).state).toBe('hold')
  })
  it('경고 등급이 WARN이면 추가매수가 아니다', () => {
    expect(evaluateHoldingState({ ...addRow, warn_grade: 'WARN' }, makeCtx()).state).toBe('hold')
  })
  it('매도 신호면 추가매수가 아니다', () => {
    expect(evaluateHoldingState({ ...addRow, score_signal: 'SELL' }, makeCtx()).state).toBe('hold')
  })
  it('제안 수량이 0이면 추가매수가 아니다', () => {
    expect(evaluateHoldingState({ ...addRow, recommended_buy_qty: 0 }, makeCtx()).state).toBe('hold')
  })
  it('비중 경고가 있으면 추가매수를 막고 사유를 남긴다', () => {
    const r = evaluateHoldingState({ ...addRow, weight_caution: { message: '과열' } }, makeCtx())
    expect(r.state).toBe('hold')
    expect(r.reasons).toContain('비중 점검: 과열')
  })
  it('매수 보류 조건이 있으면 추가매수를 막고 사유를 남긴다', () => {
    const r = evaluateHoldingState({ ...addRow, entry_guard: { label: '급등 추격', message: '5일 급등' } }, makeCtx())
    expect(r.state).toBe('hold')
    expect(r.reasons).toContain('매수 보류(급등 추격): 5일 급등')
  })
  it('계좌정책 점수 가감이 추가매수 기준에 반영된다', () => {
    const ctx = makeCtx({ policy: policy({ add_entry_score_adjust: 10 }) })
    expect(evaluateHoldingState({ ...addRow, total_score: 75 }, ctx).state).toBe('hold')
  })
  it('아무 조건도 아니면 관망과 현재 수치를 사유로 남긴다', () => {
    const r = evaluateHoldingState({ unrealized_pct: 1.5, warn_score: 1 }, makeCtx())
    expect(r.state).toBe('hold')
    expect(r.reasons).toEqual(['추가매수/부분청산 조건 미충족', '현재 수익률 1.50%', '경고점수 1.0'])
  })
})

describe('getPerformanceGrade', () => {
  it('점수에 따라 A·B·C', () => {
    expect(getPerformanceGrade({ total_score: 80 }, DEFAULT_RULES)).toBe('A')
    expect(getPerformanceGrade({ total_score: 79 }, DEFAULT_RULES)).toBe('B')
    expect(getPerformanceGrade({ total_score: 65 }, DEFAULT_RULES)).toBe('B')
    expect(getPerformanceGrade({ total_score: 64 }, DEFAULT_RULES)).toBe('C')
  })
  it('점수가 없으면 C', () => {
    expect(getPerformanceGrade({}, DEFAULT_RULES)).toBe('C')
  })
})
