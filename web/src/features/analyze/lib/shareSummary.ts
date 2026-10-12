import { formatKrw, formatNumber } from '../../../lib/format'

/** 공유 카드에 들어갈 요약 문구(최대 4줄) */
export function buildShareSummaryLines(result: any, advisor: any): string[] {
  if (!result) return []
  const lines: string[] = []

  if (result.high != null && result.low != null) {
    lines.push(`일중 범위 ${formatKrw(result.low)} ~ ${formatKrw(result.high)}`)
  }

  const fundamentalBits = [
    result.per != null ? `PER ${formatNumber(result.per, 2)}` : null,
    result.pbr != null ? `PBR ${formatNumber(result.pbr, 2)}` : null,
    result.roe != null ? `ROE ${formatNumber(result.roe, 2)}%` : null,
  ].filter(Boolean) as string[]
  if (fundamentalBits.length > 0) {
    lines.push(fundamentalBits.join(' / '))
  }

  if (advisor?.statusLabel || advisor?.finalScore != null) {
    const advisorParts = [
      advisor?.statusLabel ? `규칙 판정 ${advisor.statusLabel}` : null,
      advisor?.finalScore != null ? `${formatNumber(advisor.finalScore, 1)}점` : null,
      advisor?.twoStage?.actionLabel ? `실행 ${advisor.twoStage.actionLabel}` : null,
    ].filter(Boolean) as string[]
    if (advisorParts.length > 0) {
      lines.push(advisorParts.join(' · '))
    }
  }

  if (advisor?.entryLow != null && advisor?.entryHigh != null) {
    lines.push(`진입구간 ${formatKrw(advisor.entryLow)} ~ ${formatKrw(advisor.entryHigh)}`)
  }

  if (advisor?.target1 != null && advisor?.stopPrice != null) {
    lines.push(`1차 목표 ${formatKrw(advisor.target1)} / 손절 ${formatKrw(advisor.stopPrice)}`)
  }

  return lines.slice(0, 4)
}

/** 분석표의 "신호" 칸 문구 */
export function buildSignalText(advisor: any): string {
  if (advisor?.twoStage?.actionLabel) return `${advisor.twoStage.actionLabel} (${advisor?.statusLabel || '대기'})`
  const status = String(advisor?.status || '').toLowerCase()
  if (status === 'strong_buy' || status === 'buy-now') return '매수+'
  if (status === 'buy' || status === 'buy-on-pullback') return '매수'
  if (status === 'add_buy' || status === 'add-buy' || status === 'additional_buy' || status === 'additional-buy' || status === 'scale_in' || status === 'scale-in') return '추가매수'
  if (status === 'partial_sell') return '익절'
  if (status === 'sell') return '손절/매도'
  if (status === 'watch') return '관망'
  return advisor?.statusLabel || '대기'
}
