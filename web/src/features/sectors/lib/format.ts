export function toNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function formatKoreanMoney(v: number): string {
  const sign = v < 0 ? "-" : ""
  const abs = Math.abs(v)
  const units = [
    { value: 1_0000_0000_0000, label: "조" },
    { value: 1_0000_0000, label: "억" },
    { value: 1_0000, label: "만" },
  ]
  for (const u of units) {
    if (abs >= u.value) {
      const q = abs / u.value
      const digits = q >= 100 ? 0 : q >= 10 ? 1 : 2
      return `${sign}${q.toFixed(digits)}${u.label}`
    }
  }
  return `${sign}${Math.round(abs).toLocaleString()}`
}

export function formatKoDateTime(value?: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function formatKoDateTimeLong(value?: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}
