/**
 * 카드·뱅킹 앱의 거래내역 캡처를 OCR로 읽은 글자에서 지출 줄을 뽑는다.
 * 결과는 지출 기록의 "빠른 기록" 입력 형식(`2026-10-09 롯데마트(캠핑) 66,890원`)으로 돌려줘서,
 * 읽기 → 분류(학습·사전) → 확인 → 저장을 지금 흐름 그대로 탄다 — 새 저장 경로를 만들지 않는다.
 *
 * - 금액은 줄 맨 뒤의 숫자(쉼표 단위)를 쓴다. OCR이 쉼표를 마침표로 읽는 경우("5.600원")도 받는다.
 * - 날짜는 줄 앞의 "10/09"·"10.09"·"10월 9일", 없으면 바로 위 날짜 머리글. 못 읽으면 날짜 없이 내보내 화면의 날짜 칸을 쓴다.
 * - 입금(+금액)은 지출이 아니라서 뺀다. 같은 날·같은 금액이 이미 기록돼 있으면 중복으로 보고 뺀다.
 */

export type SpendCaptureResult = {
  lines: string[]
  /** 이미 같은 날·같은 금액 기록이 있어 뺀 줄 */
  duplicates: number
  /** + 금액(입금·환불)이라 뺀 줄 */
  income: number
  /** 날짜·이름은 있는데 금액을 못 읽은 줄 — 직접 적어야 한다 */
  unread: number
}

const MIN_AMOUNT = 100
const MAX_AMOUNT = 100_000_000
const pad2 = (n: number) => String(n).padStart(2, '0')

function ymd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null
  const dt = new Date(Date.UTC(year, month - 1, day))
  return dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day ? `${year}-${pad2(month)}-${pad2(day)}` : null
}

/** 오늘 이후가 되는 월/일은 작년으로 본다(1월에 12/30) */
function resolveMonthDay(month: number, day: number, today: string): string | null {
  const year = Number(today.slice(0, 4))
  const d = ymd(year, month, day)
  if (!d) return null
  return d > today ? ymd(year - 1, month, day) : d
}

const WEEKDAY = /\(?[월화수목금토일](?:요일)?\)?/u
// "2026년 10월 9일" · "10월 9일" · "10.09" · "10/09" — 줄 맨 앞(또는 줄 전체)에서만
const LEAD_DATE = /^\s*(?:(20\d{2})\s*[년.\-/]\s*)?(\d{1,2})\s*(?:월|[./-])\s*(\d{1,2})\s*(?:일)?(?!\d|:)/u
const AMOUNT_END = /([+＋\-−–]?)\s*(\d{1,3}(?:[,.]\d{3})+|\d{3,})\s*원?\s*$/u

const lettersOf = (s: string) => (s.match(/[가-힣A-Za-z]/g) ?? []).length
// 거래가 아니라 합계 줄(이번 달 총 지출 … 원)이라 지출로 넣으면 두 번 센다
// (가게 이름이 "총각네…"처럼 시작할 수 있어 "총"은 합계 말이 뒤따를 때만 본다)
const TOTAL_LINE = /^(합계|총\s?합계|총\s?(지출|액|사용|이용|결제)|소계|전체\s?(지출|합계)|누적|이번\s?달|지난\s?달|월\s?합계)/u

function cleanMerchant(raw: string): string {
  return raw
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ') // 시각
    .replace(/[|•·│¦_~=]+/g, ' ')
    .replace(/^[^가-힣A-Za-z0-9(]+/u, '')
    .replace(/[^가-힣A-Za-z0-9)]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

export function parseSpendCapture(text: string, today: string, existing: Array<{ date: string; amount: number }> = []): SpendCaptureResult {
  const have = new Set(existing.map((e) => `${e.date}|${e.amount}`))
  const lines: string[] = []
  let duplicates = 0
  let income = 0
  let unread = 0
  let headerDate: string | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim()
    if (!line) continue

    let date: string | null = null
    let rest = line
    const dm = LEAD_DATE.exec(line)
    if (dm) {
      date = dm[1] ? ymd(Number(dm[1]), Number(dm[2]), Number(dm[3])) : resolveMonthDay(Number(dm[2]), Number(dm[3]), today)
      rest = line.slice(dm[0].length).replace(WEEKDAY, ' ').trim()
    }

    const am = AMOUNT_END.exec(rest)
    if (!am) {
      // 날짜 머리글(남은 글자가 거의 없음) — 아래 줄들의 날짜가 된다
      if (date && lettersOf(rest) < 2) headerDate = date
      else if (date && lettersOf(rest) >= 2) unread++
      continue
    }
    const sign = am[1]
    const amount = Number(am[2].replace(/[,.]/g, ''))
    const merchant = cleanMerchant(rest.slice(0, am.index))
    if (lettersOf(merchant) < 2 || amount < MIN_AMOUNT || amount > MAX_AMOUNT || TOTAL_LINE.test(merchant)) {
      // 금액만 있고 이름이 없거나(합계 줄 등) 비정상 금액
      if (date && lettersOf(rest) >= 2) unread++
      continue
    }
    if (sign && /[+＋]/.test(sign)) { income++; continue }

    const rowDate = date ?? headerDate
    if (rowDate && have.has(`${rowDate}|${amount}`)) { duplicates++; continue }
    lines.push(`${rowDate ? `${rowDate} ` : ''}${merchant} ${amount.toLocaleString('ko-KR')}원`)
  }
  return { lines, duplicates, income, unread }
}
