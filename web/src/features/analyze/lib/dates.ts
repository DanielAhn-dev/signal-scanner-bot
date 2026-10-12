export function formatDate(value: unknown): string {
  if (!value) return '—'
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

export function formatDateTime(value: unknown): string {
  if (!value) return '—'
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

/** 일중 범위 안에서 종가 위치(0~100%). 고가=저가면 null */
export function calcPriceBarPct(result: any): number | null {
  return result?.high != null && result?.low != null && result?.high !== result?.low
    ? ((result.close - result.low) / (result.high - result.low)) * 100
    : null
}
