import type { AccountPolicy } from '../types'
import type { MacroRisk } from './macroRisk'

export type RuleSettings = {
  gradeAThreshold: number
  gradeBThreshold: number
  addEntryMinScore: number
  partialTakeProfitPct: number
  partialWarnScoreMin: number
}

/** 사용자가 입력한 규칙값을 허용 범위로 보정한다(0·빈 값은 기본값) */
export function clampRuleSettings(raw: RuleSettings): RuleSettings {
  const gradeA = Math.max(1, Math.min(100, Number(raw.gradeAThreshold || 80)))
  return {
    gradeAThreshold: gradeA,
    gradeBThreshold: Math.max(0, Math.min(gradeA - 1, Number(raw.gradeBThreshold || 65))),
    addEntryMinScore: Math.max(0, Math.min(100, Number(raw.addEntryMinScore || 70))),
    partialTakeProfitPct: Math.max(0, Math.min(50, Number(raw.partialTakeProfitPct || 8))),
    partialWarnScoreMin: Math.max(0, Math.min(10, Number(raw.partialWarnScoreMin || 3))),
  }
}

/** 거시 위험 보정을 반영한 기준값(계좌정책 적용 전) */
export function applyMacroToRules(rules: RuleSettings, macro: MacroRisk) {
  return {
    addEntryMinScore: Math.max(0, Math.min(100, rules.addEntryMinScore + macro.addScorePenalty)),
    partialTakeProfitPct: Math.max(0, Math.min(50, rules.partialTakeProfitPct - macro.partialTakeProfitBonus)),
  }
}

export type MacroAdjustedBase = ReturnType<typeof applyMacroToRules>

/** 계좌정책의 가감을 얹은 종목별 최종 기준 */
export function resolveAdvisoryThresholds(base: MacroAdjustedBase, policy: AccountPolicy | null) {
  return {
    addEntry: Math.max(0, Math.min(100, base.addEntryMinScore + Number(policy?.add_entry_score_adjust || 0))),
    partialTp: Math.max(0, Math.min(50, base.partialTakeProfitPct + Number(policy?.partial_take_profit_adjust_pct || 0))),
    policy,
  }
}
