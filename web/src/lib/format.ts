export function formatKrw(value: any) {
  if (value == null) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  // round to whole won (no decimal won display)
  const rounded = Math.round(n)
  return rounded.toLocaleString('ko-KR') + '원'
}

export function formatNumber(value: any, decimals?: number) {
  if (value == null) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  if (decimals != null) return n.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return n.toLocaleString('ko-KR')
}

export function signedClass(value: any) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  if (n < 0) return 'text-red-600'
  if (n > 0) return 'text-green-600'
  return ''
}
