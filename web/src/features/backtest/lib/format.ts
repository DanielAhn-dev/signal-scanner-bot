export function pct(value: number | null | undefined, digits = 1): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${n.toFixed(digits)}%`
}

export function signedPct(value: number | null | undefined, digits = 1): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

export function toEokFromWon(value: number | null | undefined): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n / 100_000_000
}
