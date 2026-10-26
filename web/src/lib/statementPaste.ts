/**
 * 카드 명세서·이용내역에서 복사해 붙여넣은 글자에서 지출 줄을 뽑는다.
 * 결과는 지출 기록의 "빠른 기록" 입력 형식(`2026-10-09 롯데마트(캠핑) 66,890원`)이라,
 * 읽기 → 분류(학습·사전) → 확인 → 저장을 지금 흐름 그대로 탄다 — 새 저장 경로를 만들지 않는다.
 * (이미지 캡처 읽기는 세로로 긴 화면의 해상도 때문에 정확도가 모자라 두지 않는다. 복사한 글자가 가장 정확하다.)
 *
 * 한 건이 줄 여러 개로 이어지는 "블록형"을 읽는다. 금액만 있는 줄("4,560원")이 한 건의 기준이고 바로 위 줄이 가맹점이다.
 * 날짜는 두 모양:
 *  - 위쪽 머리글(현대카드: `이용 일자: 26. 10. 25`, 날짜뿐인 줄)이 이어지는 항목들의 날짜
 *  - 금액 바로 아래 줄(삼성 모니모: `26. 9. 25본 인 6163`, 날짜 뒤에 글자가 붙은 줄)이 그 건의 날짜
 * 결제구분·카드명·적립 예정·보너스P 같은 줄은 금액만 있는 줄이 아니라서 자연히 건너뛴다.
 * 입금(+금액)·취소(−금액)·같은 날 같은 금액의 기존 기록은 빼고 건수를 알린다.
 */

export type StatementResult = {
  lines: string[]
  /** 이미 같은 날·같은 금액 기록이 있어 뺀 줄 */
  duplicates: number
  /** + 금액(입금)이라 뺀 줄 */
  income: number
  /** − 금액(취소·환불)이라 뺀 줄 — 필요하면 "환급"으로 직접 적는다 */
  cancelled: number
  /** 날짜는 있는데 금액·가맹점을 읽지 못한 줄 — 직접 적어야 한다 */
  unread: number
  /** 붙여넣은 글에 적힌 "총 N건" (없으면 null) — 읽은 건수와 맞춰 보는 용도 */
  declared: number | null
}

const MIN_AMOUNT = 100
const MAX_AMOUNT = 100_000_000
const pad2 = (n: number) => String(n).padStart(2, '0')

function ymd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null
  const dt = new Date(Date.UTC(year, month - 1, day))
  return dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day ? `${year}-${pad2(month)}-${pad2(day)}` : null
}

const WEEKDAY = /[(\[{]?\s*[월화수목금토일](?:요일)?\s*[)\]}]?/u
// "26. 10. 25 (토)" — 연(2자리). 월. 일
const YY_DATE = /^\s*(\d{2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})(?!\d)/u
// "2026-10-09" · "2026.10.09"
const FULL_DATE = /^\s*(20\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/u

const lettersOf = (s: string) => (s.match(/[가-힣A-Za-z]/g) ?? []).length
// 거래가 아니라 합계 줄이라 지출로 넣으면 두 번 센다
// (가게 이름이 "총각네…"처럼 시작할 수 있어 "총"은 합계 말이 뒤따를 때만 본다)
const TOTAL_LINE = /^(합계|총\s?합계|총\s?(지출|액|금액|건)|소계|전체\s?(지출|합계)|누적|이번\s?달|지난\s?달|월\s?합계|명세서|청구|결제\s?예정)/u
const LABEL = /^(이용\s*일자|이용\s*일|거래\s*일자|승인\s*일자|사용\s*일자)\s*[:：]?\s*/u
const SEPARATOR = /^[-=_–—━─\s]{3,}$/u
const AMOUNT_ONLY = /^([+＋\-−–]?)\s*(\d{1,3}(?:,\d{3})+|\d+)\s*원$/u
const BONUS_LINE = /^보너스\s?P?\b/u

type DateRead = { date: string | null; rest: string }

/** 줄 맨 앞의 날짜. 오늘 이후이거나 없는 날짜는 date가 null */
function leadDate(line: string, today: string): DateRead | null {
  const full = FULL_DATE.exec(line)
  if (full) {
    const d = ymd(Number(full[1]), Number(full[2]), Number(full[3]))
    return { date: d && d <= today ? d : null, rest: line.slice(full[0].length) }
  }
  const yy = YY_DATE.exec(line)
  if (yy) {
    const d = ymd(2000 + Number(yy[1]), Number(yy[2]), Number(yy[3]))
    return { date: d && d <= today ? d : null, rest: line.slice(yy[0].length) }
  }
  return null
}

/** 줄 정리: 공백 접기, "이용 일자:" 같은 날짜 이름표 떼기, 구분선·빈 줄 버리기 */
function normalizedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim().replace(LABEL, ''))
    .filter((l) => l !== '' && !SEPARATOR.test(l))
}

/** 날짜뿐인 줄(요일만 붙을 수 있음) — 아래 항목들의 머리글 */
function headerDateOf(line: string, today: string): string | null {
  const ld = leadDate(line, today)
  return ld?.date && lettersOf(ld.rest.replace(WEEKDAY, ' ')) < 2 ? ld.date : null
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

/** "총 20건 총금액 593,750원"의 건수 */
function declaredCount(text: string): number | null {
  const m = /총\s*(\d+)\s*건/u.exec(text)
  return m ? Number(m[1]) : null
}

/**
 * 블록형인지: 금액만 있는 줄이 있고, 날짜 줄이 있다.
 * 직접 한 줄씩 적은 글("우유 2 3690")은 둘 다 없어서 지금처럼 그대로 읽는다.
 */
export function looksLikeBlockStatement(text: string): boolean {
  const lines = normalizedLines(text)
  return lines.some((l) => AMOUNT_ONLY.test(l)) && lines.some((l) => leadDate(l, '9999-12-31')?.date != null)
}

export function parseBlockStatement(text: string, today: string, existing: Array<{ date: string; amount: number }> = []): StatementResult {
  // 같은 날 같은 금액이 여러 건일 수 있어(예: 같은 가게 1,000원 두 번) 기존 기록 수만큼만 중복으로 뺀다
  const have = new Map<string, number>()
  for (const e of existing) have.set(`${e.date}|${e.amount}`, (have.get(`${e.date}|${e.amount}`) ?? 0) + 1)
  const r: StatementResult = { lines: [], duplicates: 0, income: 0, cancelled: 0, unread: 0, declared: declaredCount(text) }
  const lines = normalizedLines(text)
  // 날짜 머리글이 있는 글에서 첫 머리글보다 위의 금액은 상단 합계("11월 12일 명세서 613,900원")라서 건너뛴다
  const hasHeader = lines.some((l) => headerDateOf(l, today) != null)
  let headerDate: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const header = headerDateOf(lines[i], today)
    if (header) { headerDate = header; continue }
    const am = AMOUNT_ONLY.exec(lines[i])
    if (!am) continue
    const amount = Number(am[2].replace(/,/g, ''))

    // 가맹점: 위로 올라가며 처음 만나는 일반 줄(날짜·보너스·다른 금액 줄이 아닌 것)
    let merchant = ''
    for (let j = i - 1; j >= 0; j--) {
      if (AMOUNT_ONLY.test(lines[j]) || leadDate(lines[j], '9999-12-31')) break
      if (BONUS_LINE.test(lines[j])) continue
      merchant = cleanMerchant(lines[j])
      break
    }
    // 날짜: 금액 바로 아래 줄이 "날짜+글자"(모니모)면 그 건의 것, 아니면 위쪽 머리글(현대카드)
    const next = lines[i + 1]
    const nextLead = next ? leadDate(next, today) : null
    const own = nextLead && lettersOf(nextLead.rest.replace(WEEKDAY, ' ')) >= 2 ? nextLead.date : null
    const date = own ?? headerDate

    if (lettersOf(merchant) < 2 || amount < MIN_AMOUNT || amount > MAX_AMOUNT || TOTAL_LINE.test(merchant)) {
      if (date && !TOTAL_LINE.test(merchant)) r.unread++
      continue
    }
    if (hasHeader && !date) continue
    if (/[+＋]/.test(am[1])) { r.income++; continue }
    if (/[-−–]/.test(am[1])) { r.cancelled++; continue }
    const key = date ? `${date}|${amount}` : ''
    if (key && (have.get(key) ?? 0) > 0) { have.set(key, (have.get(key) ?? 0) - 1); r.duplicates++; continue }
    r.lines.push(`${date ? `${date} ` : ''}${merchant} ${amount.toLocaleString('ko-KR')}원`)
  }
  return r
}

/** 읽은 결과 안내 문구 */
export function statementNotice(r: StatementResult): string {
  const extras = [
    r.duplicates > 0 ? `이미 있는 ${r.duplicates}건` : '',
    r.income > 0 ? `입금 ${r.income}건` : '',
    r.cancelled > 0 ? `취소·환불 ${r.cancelled}건` : '',
  ].filter(Boolean)
  const lost = r.unread > 0 ? ` 금액을 못 읽은 ${r.unread}줄은 직접 적어 주세요.` : ''
  const cancel = r.cancelled > 0 ? ' 취소·환불은 필요하면 "환급 가게 금액"으로 적으세요.' : ''
  const handled = r.lines.length + r.duplicates + r.income + r.cancelled
  const count = r.declared != null && r.declared !== handled ? ` 붙여넣은 글에는 총 ${r.declared}건이라 적혀 있는데 ${handled}건을 읽었습니다. 빠지거나 더 붙은 건이 없는지 확인하세요.` : ''
  if (r.lines.length === 0) return `붙여넣은 글에서 읽은 지출이 없습니다.${lost}${cancel}${count}`
  return `${r.lines.length}줄을 읽었습니다${extras.length ? ` (${extras.join('·')}은 뺐어요)` : ''}. 가게 이름·금액을 대조하고 확인하세요.${lost}${cancel}${count}`
}
