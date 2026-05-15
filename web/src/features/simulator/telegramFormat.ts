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

/** 리스크/리워드 비율 (목표 / 손절) */
export function calcRR(item: HighlightPlanItem): number {
  if (item.stopPct <= 0) return 0
  return item.targetPct / item.stopPct
}

/**
 * 켈리 기준 추천 투자 비율 (%)
 * f* = W - (1-W)/R, R = 목표/손절
 * 보수적 적용을 위해 절반 켈리(half-kelly)로 계산, 최대 25% 캡
 */
export function calcKelly(item: HighlightPlanItem): number {
  const w = item.winProb / 100
  const rr = calcRR(item)
  if (rr <= 0 || w <= 0) return 0
  const fullKelly = w - (1 - w) / rr
  const halfKelly = fullKelly * 0.5
  return Math.max(0, Math.min(25, halfKelly * 100))
}

export type TradeGrade = 'A' | 'B' | 'C' | 'D'

/** 거래 품질 등급 — R:R + 승률 + 기대값 기반 */
export function getTradeGrade(item: HighlightPlanItem): TradeGrade {
  const rr = calcRR(item)
  const w = item.winProb / 100
  const ev = calcExpectedValue(item)
  if (ev <= 0) return 'D'
  if (rr >= 2.5 && w >= 0.58) return 'A'
  if (rr >= 2.0 && w >= 0.52) return 'B'
  if (rr >= 1.5 && ev > 0) return 'C'
  return 'D'
}

/** 전 종목 손절 시 최대 손실 금액 (음수 반환) */
export function calcMaxPortfolioLoss(items: HighlightPlanItem[]): number {
  return -items.reduce((acc, item) => acc + item.amount * (item.stopPct / 100), 0)
}

/** 특정 등락률 시나리오의 순수익 계산 */
export function calcScenarioNet(
  items: HighlightPlanItem[],
  changePct: number,
  fillRatePct: number,
  feePct: number,
  taxPct: number,
): number {
  return items.reduce((acc, item) => {
    const invested = calcSplitInvested(item, fillRatePct)
    const gross = invested * (changePct / 100)
    const fee = invested * (feePct / 100)
    const tax = changePct > 0 ? gross * (taxPct / 100) : 0
    return acc + gross - fee - tax
  }, 0)
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
