/**
 * 카드 명세서·거래내역(캡처를 OCR로 읽은 글자, 또는 메일에서 복사해 붙여넣은 글자)에서 지출 줄을 뽑는다.
 * 결과는 지출 기록의 "빠른 기록" 입력 형식(`2026-10-09 롯데마트(캠핑) 66,890원`)으로 돌려줘서,
 * 읽기 → 분류(학습·사전) → 확인 → 저장을 지금 흐름 그대로 탄다 — 새 저장 경로를 만들지 않는다.
 *
 * 두 가지 모양을 읽는다:
 *  - 한 줄형(현대카드 명세서 캡처 등): `씨유CU 4,560원`, 날짜는 위쪽 머리글 `26. 10. 25 (토)`
 *  - 블록형(삼성 모니모 메일 복사): `가맹점` / `금액원` / (빈 줄) / `26. 9. 25본 인 6163` / `보너스P 421P`
 * 날짜는 `26. 10. 25`(연. 월. 일)·`10/09`·`10월 9일` 모두 읽는다. 연도가 한 해 안이 아니면 OCR 오독으로 보고 월·일만 쓴다.
 * 입금(+금액)·취소(−금액)·합계 줄·같은 날 같은 금액의 기존 기록은 빼고 건수를 알린다.
 */

export type SpendCaptureResult = {
  lines: string[]
  /** 이미 같은 날·같은 금액 기록이 있어 뺀 줄 */
  duplicates: number
  /** + 금액(입금)이라 뺀 줄 */
  income: number
  /** − 금액(취소·환불)이라 뺀 줄 — 필요하면 "환급"으로 직접 적는다 */
  cancelled: number
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

/** 연도가 있으면 쓰되, 오늘 기준 한 해 안이 아니면(OCR이 26을 20으로 읽는 일 등) 월·일만으로 정한다 */
function resolveDate(year: number | null, month: number, day: number, today: string): string | null {
  const thisYear = Number(today.slice(0, 4))
  if (year != null && (year === thisYear || year === thisYear - 1)) {
    const d = ymd(year, month, day)
    return d && d <= today ? d : null
  }
  return resolveMonthDay(month, day, today)
}

const WEEKDAY = /[(\[{]?\s*[월화수목금토일](?:요일)?\s*[)\]}]?/u
// "26. 10. 25 (토)" · "26.10. 24(%)"(OCR 깨짐) — 연(2자리). 월. 일, 일 뒤는 무엇이든
const YY_DATE = /^\s*(\d{2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/u
// "2026년 10월 9일" · "10월 9일" · "10.09" · "10/09" — 줄 맨 앞에서만
const LEAD_DATE = /^\s*(?:(20\d{2})\s*[년.\-/]\s*)?(\d{1,2})\s*(?:월|[./-])\s*(\d{1,2})\s*(?:일)?(?!\d|:)/u

const lettersOf = (s: string) => (s.match(/[가-힣A-Za-z]/g) ?? []).length
// 거래가 아니라 합계·명세서 줄이라 지출로 넣으면 두 번 센다
// (가게 이름이 "총각네…"처럼 시작할 수 있어 "총"은 합계 말이 뒤따를 때만 본다)
const TOTAL_LINE = /^(합계|총\s?합계|총\s?(지출|액|사용|이용|결제)|소계|전체\s?(지출|합계)|누적|이번\s?달|지난\s?달|월\s?합계|명세서|청구|결제\s?예정)/u

type DateRead = { date: string | null; rest: string }

/** 줄 맨 앞의 날짜. 없으면 null */
function leadDate(line: string, today: string): DateRead | null {
  const yy = YY_DATE.exec(line)
  if (yy) return { date: resolveDate(2000 + Number(yy[1]), Number(yy[2]), Number(yy[3]), today), rest: line.slice(yy[0].length) }
  const dm = LEAD_DATE.exec(line)
  if (dm) return { date: resolveDate(dm[1] ? Number(dm[1]) : null, Number(dm[2]), Number(dm[3]), today), rest: line.slice(dm[0].length) }
  return null
}

/**
 * 줄 끝 금액 토큰 → 원. 쉼표를 마침표·슬래시로 읽어도 받고,
 * 낮은 해상도에서 "원"이 8로 읽히는 경우("4.5608"→4,560 · "58008"→5,800)를 바로잡는다.
 * 쉼표 묶음이 4자리면 어차피 잘못된 값이라 끝 8을 뗀다. 쉼표가 없는 5자리 이상이 8로 끝나고 앞이 10 단위면 같은 경우로 본다.
 */
export function readAmountTail(rest: string): { amount: number; sign: string; head: string } | null {
  // 끝의 "원"은 원·#8·%·8 등으로 읽힌다 — 숫자 뒤 기호 몇 개와 8 하나까지 받는다
  const m = /^(.*?)(?:^|\s)([+＋\-−–]?)([\d][\d,./]*)[^\d\s(]{0,3}8?\s*$/u.exec(rest)
  if (!m) return null
  const head = m[1]
  const sign = m[2]
  const groups = m[3].split(/[,./]/).filter((g) => g !== '')
  if (groups.length === 0 || /[,./]$/.test(m[3])) return null
  let digits: string
  if (groups.length >= 2) {
    const last = groups[groups.length - 1]
    if (last.length === 4 && last.endsWith('8')) groups[groups.length - 1] = last.slice(0, 3)
    if (groups[0].length > 3 || groups.slice(1).some((g) => g.length !== 3)) return null
    digits = groups.join('')
  } else {
    digits = groups[0]
    if (digits.length >= 5 && digits.endsWith('8') && Number(digits.slice(0, -1)) % 10 === 0) digits = digits.slice(0, -1)
  }
  const amount = Number(digits)
  return Number.isFinite(amount) && amount >= MIN_AMOUNT && amount <= MAX_AMOUNT ? { amount, sign, head } : null
}

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

const emptyResult = (): SpendCaptureResult => ({ lines: [], duplicates: 0, income: 0, cancelled: 0, unread: 0 })

function pushLine(r: SpendCaptureResult, have: Set<string>, date: string | null, merchant: string, amount: number, sign: string) {
  if (sign && /[+＋]/.test(sign)) { r.income++; return }
  if (sign && /[-−–]/.test(sign)) { r.cancelled++; return }
  if (date && have.has(`${date}|${amount}`)) { r.duplicates++; return }
  r.lines.push(`${date ? `${date} ` : ''}${merchant} ${amount.toLocaleString('ko-KR')}원`)
}

/** 한 줄형: 가맹점과 금액이 같은 줄에 있다 (현대카드 명세서·거래내역 캡처 등) */
export function parseSpendCapture(text: string, today: string, existing: Array<{ date: string; amount: number }> = []): SpendCaptureResult {
  const have = new Set(existing.map((e) => `${e.date}|${e.amount}`))
  const r = emptyResult()
  let headerDate: string | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim()
    if (!line) continue

    const lead = leadDate(line, today)
    const rest = (lead ? lead.rest.replace(WEEKDAY, ' ') : line).trim()
    const tail = readAmountTail(rest)
    if (!tail) {
      // 날짜 머리글(남은 글자가 거의 없음) — 아래 줄들의 날짜가 된다
      if (lead?.date && lettersOf(rest) < 2) headerDate = lead.date
      else if (lead?.date && lettersOf(rest) >= 2) r.unread++
      continue
    }
    const merchant = cleanMerchant(tail.head)
    if (lettersOf(merchant) < 2 || TOTAL_LINE.test(merchant)) {
      if (lead?.date && lettersOf(rest) >= 2 && !TOTAL_LINE.test(merchant)) r.unread++
      continue
    }
    pushLine(r, have, lead?.date ?? headerDate, merchant, tail.amount, tail.sign)
  }
  return r
}

const AMOUNT_ONLY = /^([+＋\-−–]?)\s*(\d{1,3}(?:,\d{3})+|\d+)\s*원$/u
const BONUS_LINE = /^보너스\s?P?\b/u
const DATE_START = /^\s*\d{2}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}/u

/**
 * 블록형인지: "금액원"만 있는 줄이 있고, "26. 9. 25"로 시작하는 줄이 있다 (삼성 모니모 메일 복사).
 * 한 줄형(가맹점과 금액이 같은 줄)이 섞여 있어도 이 모양이 있으면 블록형으로 읽는다.
 */
export function looksLikeBlockStatement(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  return lines.some((l) => AMOUNT_ONLY.test(l)) && lines.some((l) => DATE_START.test(l))
}

/**
 * 블록형: 금액만 있는 줄이 한 건의 기준 — 바로 위 줄이 가맹점, 아래쪽에서 처음 나오는 날짜 줄이 날짜.
 * 날짜 줄 뒤의 본인/가족·카드 끝자리·보너스P는 버린다.
 */
export function parseBlockStatement(text: string, today: string, existing: Array<{ date: string; amount: number }> = []): SpendCaptureResult {
  const have = new Set(existing.map((e) => `${e.date}|${e.amount}`))
  const r = emptyResult()
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    const am = AMOUNT_ONLY.exec(lines[i])
    if (!am) continue
    const amount = Number(am[2].replace(/,/g, ''))
    // 가맹점: 위로 올라가며 처음 만나는 일반 줄(날짜·보너스·다른 금액 줄이 아닌 것)
    let merchant = ''
    for (let j = i - 1; j >= 0; j--) {
      if (AMOUNT_ONLY.test(lines[j]) || DATE_START.test(lines[j])) break
      if (BONUS_LINE.test(lines[j])) continue
      merchant = cleanMerchant(lines[j])
      break
    }
    // 날짜: 아래로 내려가며 다음 금액 줄 전까지 처음 나오는 날짜 줄
    let date: string | null = null
    for (let j = i + 1; j < lines.length && !AMOUNT_ONLY.test(lines[j]); j++) {
      const lead = DATE_START.test(lines[j]) ? leadDate(lines[j], today) : null
      if (lead) { date = lead.date; break }
    }
    if (lettersOf(merchant) < 2 || amount < MIN_AMOUNT || amount > MAX_AMOUNT) { if (date) r.unread++; continue }
    pushLine(r, have, date, merchant, amount, am[1])
  }
  return r
}

/** 붙여넣은 글자 → 블록형이면 블록형으로, 아니면 한 줄형으로 읽는다 */
export function parseStatementText(text: string, today: string, existing: Array<{ date: string; amount: number }> = []): SpendCaptureResult & { block: boolean } {
  const block = looksLikeBlockStatement(text)
  return { ...(block ? parseBlockStatement(text, today, existing) : parseSpendCapture(text, today, existing)), block }
}

/** 읽은 결과 안내 문구 */
export function spendNotice(r: SpendCaptureResult, subject: string): string {
  const extras = [
    r.duplicates > 0 ? `이미 있는 ${r.duplicates}건` : '',
    r.income > 0 ? `입금 ${r.income}건` : '',
    r.cancelled > 0 ? `취소·환불 ${r.cancelled}건` : '',
  ].filter(Boolean)
  const lost = r.unread > 0 ? ` 금액을 못 읽은 ${r.unread}줄은 직접 적어 주세요.` : ''
  const cancel = r.cancelled > 0 ? ' 취소·환불은 필요하면 "환급 가게 금액"으로 적으세요.' : ''
  if (r.lines.length === 0) return `${subject}에서 읽은 지출이 없습니다.${lost}${cancel}`
  return `${r.lines.length}줄을 읽었습니다${extras.length ? ` (${extras.join('·')}은 뺐어요)` : ''}. 가게 이름·금액을 대조하고 확인하세요.${lost}${cancel}`
}
