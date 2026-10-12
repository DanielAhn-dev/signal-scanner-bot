export function decodeHeadlineText(input: string): string {
  const base = String(input || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const value = Number(dec)
      return Number.isFinite(value) ? String.fromCharCode(value) : _m
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const value = Number.parseInt(hex, 16)
      return Number.isFinite(value) ? String.fromCharCode(value) : _m
    })

  return base.replace(/\s{2,}/g, ' ').trim()
}

export function normalizeNewsUrl(input: unknown): string | null {
  const value = String(input || '').trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('//')) return `https:${value}`
  return null
}

export function normalizeNewsSource(input: unknown): string | null {
  const value = decodeHeadlineText(String(input || ''))
  return value || null
}

export function normalizeDateLabel(input: unknown): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  const dateOnly = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0]
  if (dateOnly) return dateOnly
  const compact = raw.match(/(\d{4})[./](\d{1,2})[./](\d{1,2})/)
  if (compact) {
    const y = compact[1]
    const m = compact[2].padStart(2, '0')
    const d = compact[3].padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const ts = Date.parse(raw)
  if (Number.isFinite(ts)) {
    return new Date(ts).toISOString().slice(0, 10)
  }
  return null
}

export function formatDateRangeLabel(values: Array<string | null | undefined>): string | null {
  const uniq = Array.from(new Set(values.map((value) => normalizeDateLabel(value)).filter(Boolean) as string[])).sort()
  if (uniq.length === 0) return null
  if (uniq.length === 1) return uniq[0]
  return `${uniq[0]}~${uniq[uniq.length - 1]}`
}

export function formatRowDataAsOf(marketDataDate: string | null, newsDataDate: string | null): string {
  const market = normalizeDateLabel(marketDataDate)
  const news = normalizeDateLabel(newsDataDate)
  const parts = [
    market ? `시세 ${market}` : null,
    news ? `뉴스 ${news}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : '—'
}
