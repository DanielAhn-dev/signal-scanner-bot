export function getKstDateKey(date: Date = new Date()): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

export function normalizeDateKey(raw: unknown): string | null {
  if (!raw) return null
  const text = String(raw).trim()
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return getKstDateKey(parsed)
}

export function toKstMidnightMs(dateKey: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null
  const ms = Date.parse(`${dateKey}T00:00:00+09:00`)
  if (Number.isNaN(ms)) return null
  return ms
}

export function uniqueSortedDateKeys(values: string[], limit: number): string[] {
  return [...new Set(values)]
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, limit)
}

export function computeSignalAgeDays(signalDate: string | null | undefined, asOfDate: string): number | null {
  if (!signalDate) return null
  const signalMs = toKstMidnightMs(signalDate)
  const asOfMs = toKstMidnightMs(asOfDate)
  if (signalMs == null || asOfMs == null) return null
  const diff = asOfMs - signalMs
  if (diff < 0) return null
  return Math.floor(diff / 86_400_000)
}
