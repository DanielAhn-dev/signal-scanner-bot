export function getTodayLocalYmd(): string {
  const now = new Date()
  const tzOffsetMs = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 10)
}

/** 서버 시각(UTC)을 KST 날짜(YYYY-MM-DD)로 */
export function toKstYmd(iso: string | null | undefined): string | null {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isFinite(t) ? new Date(t + 9 * 3_600_000).toISOString().slice(0, 10) : null
}

/** 지난 날짜 매수 기록은 최근 7일까지만 받는다(서버와 같은 기준) */
export function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
