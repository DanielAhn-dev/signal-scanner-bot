import { formatKrw, formatNumber } from '../../../lib/format'

export function getFlowMetricLabel(metric?: string | null): string | null {
  if (metric === 'volume') return '거래량'
  if (metric === 'amount') return '거래대금'
  return null
}

export function formatCompactKrw(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 100_000_000) {
    const eok = Math.round(abs / 10_000_000) / 10
    return `${sign}${formatNumber(eok, eok % 1 === 0 ? 0 : 1)}억원`
  }
  if (abs >= 10_000) return `${sign}${formatNumber(Math.round(abs / 10_000))}만원`
  return `${sign}${formatNumber(Math.round(abs))}원`
}

export function formatFlowValue(value: number | null, metric?: string | null): string {
  if (value == null) return '—'
  if (metric === 'volume') return `${formatNumber(value, 0)}주`
  return metric === 'amount' ? formatCompactKrw(value) : formatKrw(value)
}
