import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSyncedSettings } from '../../../lib/userState'
import { clampRuleSettings } from '../lib/thresholds'

export function useHoldingRules() {
  const [gradeAThreshold, setGradeAThreshold] = useState(80)
  const [gradeBThreshold, setGradeBThreshold] = useState(65)
  const [addEntryMinScore, setAddEntryMinScore] = useState(70)
  const [partialTakeProfitPct, setPartialTakeProfitPct] = useState(8)
  const [partialWarnScoreMin, setPartialWarnScoreMin] = useState(3)

  useSyncedSettings(
    'holdingRules',
    { gradeAThreshold, gradeBThreshold, addEntryMinScore, partialTakeProfitPct, partialWarnScoreMin },
    { gradeAThreshold: 80, gradeBThreshold: 65, addEntryMinScore: 70, partialTakeProfitPct: 8, partialWarnScoreMin: 3 },
    (saved) => {
      const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null)
      const a = num(saved.gradeAThreshold); if (a != null) setGradeAThreshold(a)
      const b = num(saved.gradeBThreshold); if (b != null) setGradeBThreshold(b)
      const add = num(saved.addEntryMinScore); if (add != null) setAddEntryMinScore(add)
      const pct = num(saved.partialTakeProfitPct); if (pct != null) setPartialTakeProfitPct(pct)
      const warn = num(saved.partialWarnScoreMin); if (warn != null) setPartialWarnScoreMin(warn)
    },
  )

  const rules = clampRuleSettings({ gradeAThreshold, gradeBThreshold, addEntryMinScore, partialTakeProfitPct, partialWarnScoreMin })
  const safeGradeAThreshold = rules.gradeAThreshold
  const safeGradeBThreshold = rules.gradeBThreshold
  const safeAddEntryMinScore = rules.addEntryMinScore
  const safePartialWarnScoreMin = rules.partialWarnScoreMin

  return {
    gradeAThreshold,
    setGradeAThreshold,
    gradeBThreshold,
    setGradeBThreshold,
    addEntryMinScore,
    setAddEntryMinScore,
    partialTakeProfitPct,
    setPartialTakeProfitPct,
    partialWarnScoreMin,
    setPartialWarnScoreMin,
    rules,
    safeGradeAThreshold,
    safeGradeBThreshold,
    safeAddEntryMinScore,
    safePartialWarnScoreMin,
  }
}
