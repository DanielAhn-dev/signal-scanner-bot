import { formatKrw } from '../../../lib/format'

export function formatSignedKrw(value: number): string {
  const num = Number(value || 0)
  if (num === 0) return formatKrw(0)
  return `${num > 0 ? '+' : '-'}${formatKrw(Math.abs(num))}`
}
