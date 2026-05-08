import { formatKrw, formatNumber } from '../../lib/format'
import type { HighlightPlanItem } from './planStore'

export type TelegramFormat = 'simple' | 'detailed'

export function clampPercent(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

export function calcExpectedValue(item: HighlightPlanItem) {
  const invested = item.amount
  const targetProfit = invested * (item.targetPct / 100)
  const stopLoss = invested * (item.stopPct / 100)
  return invested > 0
    ? targetProfit * (item.winProb / 100) - stopLoss * (1 - item.winProb / 100)
    : 0
}

export function calcSplitInvested(item: HighlightPlanItem, fillRatePct: number) {
  const splitRatio = (item.split1 + item.split2 + item.split3) / 100
  const fillRatio = clampPercent(fillRatePct, 0, 100) / 100
  return item.amount * splitRatio * fillRatio
}

export function buildTelegramMessage(params: {
  totalCapital: number
  fillRatePct: number
  feePct: number
  taxPct: number
  expectedAfterCost: number
  remaining: number
  items: HighlightPlanItem[]
  format: TelegramFormat
}) {
  if (params.format === 'simple') {
    const lines = [
      '[시뮬레이터 간단 요약]',
      `총 ${formatKrw(params.totalCapital)} · 기대손익 ${params.expectedAfterCost >= 0 ? '+' : ''}${formatKrw(params.expectedAfterCost)}`,
      '',
    ]
    for (const row of params.items.slice(0, 10)) {
      const ev = calcExpectedValue(row)
      lines.push(`- ${row.name || row.code} ${formatKrw(row.amount)} (${ev >= 0 ? '+' : ''}${formatKrw(ev)})`)
    }
    return lines.join('\n')
  }

  // detailed
  const lines = [
    '[웹 시뮬레이터 상세 계획]',
    `총 투자금: ${formatKrw(params.totalCapital)}`,
    `체결률: ${formatNumber(params.fillRatePct, 0)}% · 비용 ${formatNumber(params.feePct, 2)}% · 세금 ${formatNumber(params.taxPct, 2)}%`,
    `기대손익(비용차감): ${params.expectedAfterCost >= 0 ? '+' : ''}${formatKrw(params.expectedAfterCost)}`,
    `잔여/초과: ${params.remaining >= 0 ? '+' : ''}${formatKrw(params.remaining)}`,
    '',
    '종목별 집행안',
  ]
  for (const row of params.items.slice(0, 10)) {
    const ev = calcExpectedValue(row)
    lines.push(
      `- ${row.name || row.code}(${row.code}) ${formatKrw(row.amount)} | 목표 ${formatNumber(row.targetPct, 1)}% / 손절 ${formatNumber(row.stopPct, 1)}% / 승률 ${formatNumber(row.winProb, 0)}%`,
    )
    lines.push(
      `  분할 ${formatNumber(row.split1, 0)}/${formatNumber(row.split2, 0)}/${formatNumber(row.split3, 0)}% · 기대손익 ${ev >= 0 ? '+' : ''}${formatKrw(ev)}`,
    )
  }
  return lines.join('\n')
}
