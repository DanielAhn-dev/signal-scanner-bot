import { formatNumber } from '../../../lib/format'
import type { AccountPolicy } from '../types'
import { accountLabel } from './accountKey'
import { toSignalLabel, toWarnLabel, WARN_REASON_LABELS } from './labels'
import type { RuleSettings } from './thresholds'

export type HoldingStateKind = 'hold' | 'add' | 'partial'

/** 보유 종목 판정에 필요한 주변 조건. 컴포넌트 상태를 클로저로 잡지 않도록 명시적으로 넘긴다 */
export type HoldingStateContext = {
  rules: RuleSettings
  /** 종목(계좌정책 포함)별 최종 기준 */
  thresholdsFor: (row: any) => { addEntry: number; partialTp: number; policy: AccountPolicy | null }
}

export function getScoreValue(row: any): number | null {
  const score = Number(row?.total_score)
  return Number.isFinite(score) ? score : null
}

export function getWarnReasonDetails(row: any): string[] {
  const details: string[] = []
  for (const item of WARN_REASON_LABELS) {
    if (row?.[item.key] === true) details.push(item.label)
  }
  return details
}

export function evaluateHoldingState(row: any, ctx: HoldingStateContext): { state: HoldingStateKind; reasons: string[] } {
  const reasons: string[] = []
  const thresholds = ctx.thresholdsFor(row)
  const safePartialWarnScoreMin = ctx.rules.partialWarnScoreMin
  const pct = Number(row?.unrealized_pct)
  const warnScoreNum = Number(row?.warn_score)
  const warnScore = Number.isFinite(warnScoreNum) ? warnScoreNum : null
  const scoreSignal = String(row?.score_signal || '').trim().toUpperCase()
  const entryGrade = String(row?.entry_grade || '').trim().toUpperCase()
  const trendGrade = String(row?.trend_grade || '').trim().toUpperCase()
  const warnGrade = String(row?.warn_grade || '').trim().toUpperCase()
  const warnDetails = getWarnReasonDetails(row)

  const partialSignalHit = ['SELL', 'HOLD'].includes(scoreSignal) || ['WARN', 'SELL'].includes(warnGrade)
  const partialWarnScoreHit = warnScore != null && warnScore >= safePartialWarnScoreMin
  if (Number.isFinite(pct) && pct >= thresholds.partialTp && partialSignalHit && partialWarnScoreHit) {
    reasons.push(`수익률 ${formatNumber(pct, 2)}% >= ${formatNumber(thresholds.partialTp, 2)}%`)
    reasons.push(`신호/경고 조건 충족 (신호 ${toSignalLabel(scoreSignal)} / 경고 ${toWarnLabel(warnGrade)})`)
    reasons.push(`경고점수 ${formatNumber(warnScore, 1)} >= 기준 ${formatNumber(safePartialWarnScoreMin, 1)}`)
    if (thresholds.policy) reasons.push(`계좌정책 반영(${accountLabel(thresholds.policy.broker_name, thresholds.policy.account_name)})`)
    if (warnDetails.length > 0) reasons.push(`상세 경고: ${warnDetails.join(', ')}`)
    return { state: 'partial', reasons }
  }

  const score = getScoreValue(row)
  // 비중 조절 경고(과열·고점 변동성 급등)가 켜진 종목은 추가매수를 권하지 않는다
  const weightCaution = row?.weight_caution as { message?: string } | null | undefined
  // 급등 추격·긴 윗꼬리·한 달 급락도 봇이 추가매수를 막는 기준 — 화면도 같이 막는다
  const entryGuard = row?.entry_guard as { label?: string; message?: string } | null | undefined
  const hasAddSignal = Number(row?.recommended_buy_qty || 0) > 0 && !weightCaution && !entryGuard
  const hasPullbackHint = Boolean(entryGrade || trendGrade || warnGrade)
  const entryTrendOk = !hasPullbackHint || (['A', 'B'].includes(entryGrade) && ['A', 'B'].includes(trendGrade))
  const riskOk = !warnGrade || ['SAFE', 'WATCH'].includes(warnGrade)
  const signalOk = !scoreSignal || scoreSignal !== 'SELL'
  const scoreOk = score == null || score >= thresholds.addEntry
  if (hasAddSignal && scoreOk && entryTrendOk && riskOk && signalOk) {
    reasons.push(`추가매수 제안 수량 ${Number(row?.recommended_buy_qty || 0)}주`)
    reasons.push(`점수 조건 ${score == null ? '점수 없음' : formatNumber(score, 1)} / 기준 ${formatNumber(thresholds.addEntry, 1)}`)
    reasons.push(`진입/추세/경고 ${entryGrade || '-'} / ${trendGrade || '-'} / ${toWarnLabel(warnGrade)}`)
    if (thresholds.policy) reasons.push(`계좌정책 반영(${accountLabel(thresholds.policy.broker_name, thresholds.policy.account_name)})`)
    if (warnDetails.length > 0) reasons.push(`상세 경고: ${warnDetails.join(', ')}`)
    return { state: 'add', reasons }
  }

  if (weightCaution?.message) reasons.push(`비중 점검: ${weightCaution.message}`)
  if (entryGuard?.message) reasons.push(`매수 보류(${entryGuard.label ?? '진입 점검'}): ${entryGuard.message}`)
  reasons.push('추가매수/부분청산 조건 미충족')
  if (Number.isFinite(pct)) reasons.push(`현재 수익률 ${formatNumber(pct, 2)}%`)
  if (warnScore != null) reasons.push(`경고점수 ${formatNumber(warnScore, 1)}`)
  if (warnDetails.length > 0) reasons.push(`상세 경고: ${warnDetails.join(', ')}`)
  return { state: 'hold', reasons }
}

export function getPerformanceGrade(row: any, rules: RuleSettings): 'A' | 'B' | 'C' {
  const score = getScoreValue(row)
  if (score == null) return 'C'
  if (score >= rules.gradeAThreshold) return 'A'
  if (score >= rules.gradeBThreshold) return 'B'
  return 'C'
}
