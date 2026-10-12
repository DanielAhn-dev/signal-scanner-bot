/** 목돈 나눠 넣기 — 금액 배분과 날짜표 계산 (화면 입력값으로만 계산, 과거 결과 숫자는 data/splitPlans.ts) */

export type SplitRow = { index: number; date: string; amount: number }

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** YYYY-MM-DD에 개월을 더한다. 말일이 없는 달(예: 31일→2월)은 그 달 말일로 맞춘다 */
export function addMonthsClamped(dateKey: string, months: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const total = (m - 1) + months
  const year = y + Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, lastDay))}`
}

/**
 * 총액을 비중대로 나눈 날짜표. 매 회차는 1원 단위로 반올림하고 마지막 회차가 나머지를 받아 합계가 총액과 같다.
 * 날짜는 시작일과 같은 일자를 매월 쓴다(휴장일이면 다음 거래일에 넣는다 — 화면 문구로 안내).
 */
export function splitSchedule(input: { total: number; weights: number[]; startDate: string }): SplitRow[] {
  const total = Math.round(input.total)
  if (!(total > 0) || !input.weights.length) return []
  const sum = input.weights.reduce((a, b) => a + b, 0)
  if (!(sum > 0)) return []
  const rows: SplitRow[] = []
  let used = 0
  input.weights.forEach((w, i) => {
    const last = i === input.weights.length - 1
    const amount = last ? total - used : Math.round((total * w) / sum)
    used += amount
    rows.push({ index: i + 1, date: addMonthsClamped(input.startDate, i), amount })
  })
  return rows
}
