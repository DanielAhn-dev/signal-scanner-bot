export function formatKrw(value: any) {
  if (value == null) return '—'
  const n = Number(value)
  // 숫자인데 NaN·Infinity면 "—" (예전엔 "NaN원"이 화면에 그대로 나왔다). 문자열은 이미 포맷된 값으로 보고 통과
  if (!Number.isFinite(n)) return typeof value === 'number' ? '—' : String(value)
  // round to whole won (no decimal won display)
  const rounded = Math.round(n)
  return rounded.toLocaleString('ko-KR') + '원'
}

export function formatKrwCompact(value: unknown, options: { showPositiveSign?: boolean } = {}): string {
  if (value == null || value === '') return '—'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'

  const rounded = Math.round(amount)
  const abs = Math.abs(rounded)
  const sign = rounded < 0 ? '-' : options.showPositiveSign && rounded > 0 ? '+' : ''
  if (abs >= 100_000_000) {
    const eok = Math.round(abs / 10_000_000) / 10
    return `${sign}${formatNumber(eok)}억원`
  }
  if (abs >= 10_000) {
    const manwon = Math.round(abs / 10_000)
    if (manwon >= 10_000) return `${sign}${formatNumber(manwon / 10_000)}억원`
    return `${sign}${formatNumber(manwon)}만원`
  }
  return `${sign}${formatNumber(abs)}원`
}

export function formatKstDateTime(value: unknown, options: Intl.DateTimeFormatOptions = {}): string {
  if (value == null || value === '') return '—'
  const date = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(date.getTime())) return '—'

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...options,
    timeZone: 'Asia/Seoul',
  }).format(date)
}

export function formatNumber(value: any, decimals?: number) {
  if (value == null) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return typeof value === 'number' ? '—' : String(value)
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
