import { formatNumber } from '../../../lib/format'
import { WEIGHT_CAUTION_SOURCE_NOTE } from './labels'
import type { HoldingStateKind } from './holdingState'

export type ReasonBadge = { label: string; type: 'partial' | 'add' | 'warn' | 'ok' | 'neutral'; title?: string }

/** 보유 카드의 판정근거 배지. 상태(holdingState)와 행의 신호·등급에서 순수하게 계산한다 */
export function buildReasonBadges(
  r: any,
  holdingState: HoldingStateKind,
  score: number | null,
  addEntryMinScore: number,
): ReasonBadge[] {
  const scoreSignal = String(r?.score_signal || '').trim().toUpperCase()
  const entryGrade = String(r?.entry_grade || '').trim().toUpperCase()
  const trendGrade = String(r?.trend_grade || '').trim().toUpperCase()
  const warnGrade = String(r?.warn_grade || '').trim().toUpperCase()
  const warnScore = Number.isFinite(Number(r?.warn_score)) ? Number(r?.warn_score) : null

  const reasonBadges: ReasonBadge[] = []
  const entryGuide = r?.entry_price_guide as { verdict: 'ok' | 'caution' | 'stale'; gapPct: number; message: string } | null | undefined
  if (entryGuide) {
    const guideLabel = entryGuide.verdict === 'ok'
      ? '지금 매수 무방'
      : entryGuide.verdict === 'caution'
        ? `추격주의 ${entryGuide.gapPct >= 0 ? '+' : ''}${entryGuide.gapPct.toFixed(1)}%`
        : `재검토 필요 ${entryGuide.gapPct >= 0 ? '+' : ''}${entryGuide.gapPct.toFixed(1)}%`
    reasonBadges.push({
      label: guideLabel,
      type: entryGuide.verdict === 'ok' ? 'ok' : 'warn',
      title: entryGuide.message,
    })
  }
  const weightCaution = r?.weight_caution as { level: 'caution' | 'strong'; message: string | null } | null | undefined
  if (weightCaution) {
    reasonBadges.push({
      label: weightCaution.level === 'strong' ? '비중 점검(강)' : '비중 점검',
      type: 'warn',
      title: `${weightCaution.message ?? ''}\n${WEIGHT_CAUTION_SOURCE_NOTE}`,
    })
  }
  if (holdingState === 'partial') {
    reasonBadges.push({ label: '익절구간', type: 'partial' })
    if (['SELL', 'HOLD'].includes(scoreSignal)) reasonBadges.push({ label: scoreSignal === 'SELL' ? '매도신호' : '보유신호', type: 'warn' })
    if (['WARN', 'SELL'].includes(warnGrade)) reasonBadges.push({ label: '경고강함', type: 'warn' })
    if (warnScore != null) reasonBadges.push({ label: `경고점수 ${formatNumber(warnScore, 0)}`, type: 'warn' })
  } else if (holdingState === 'add') {
    reasonBadges.push({ label: '추가진입', type: 'add' })
    if (score != null) reasonBadges.push({ label: `점수충족 ${formatNumber(score, 0)}`, type: 'ok' })
    if (['A', 'B'].includes(entryGrade)) reasonBadges.push({ label: `진입${entryGrade}`, type: 'ok' })
    if (['A', 'B'].includes(trendGrade)) reasonBadges.push({ label: `추세${trendGrade}`, type: 'ok' })
  } else {
    if (score != null && score < addEntryMinScore) reasonBadges.push({ label: '점수부족', type: 'neutral' })
    if (['WARN', 'SELL'].includes(warnGrade)) reasonBadges.push({ label: '경고있음', type: 'warn' })
    if (['SELL'].includes(scoreSignal)) reasonBadges.push({ label: '매도신호', type: 'warn' })
    if (reasonBadges.length === 0) reasonBadges.push({ label: '관망', type: 'neutral' })
  }
  return reasonBadges
}
