/**
 * 자녀 증여 기록·한도 추적 (2026-10 기준). 순수 함수만 둔다.
 * 서비스는 입력한 기록을 계산·알림으로 정리할 뿐 세무 판단을 하지 않는다 — 판단이 갈리는 사안은 화면에서 세무사·국세청 확인으로 안내한다.
 *
 * 규칙(검색으로 여러 안내 자료가 일치, 공식 원문은 직접 확인하지 못함):
 *  - 증여재산공제: 직계존속(부모·조부모 합산)에게서 10년간 미성년 자녀 2,000만원, 성년 5,000만원
 *  - 세율 10~50% 누진(과세표준 1억 이하 10%), 신고 기한은 증여일이 속한 달의 말일부터 3개월, 자진 신고 시 산출세액 3% 공제
 *  - 현금은 이체한 날이 증여일. 증여 뒤 오른 부분은 신고한 증여가액을 넘어도 증여세 대상이 아니다.
 * 한계: 10년 경계는 날짜 단위로 민감해 '다음 증여 가능일'에 여유 일수를 둔다. 정기금 증여·부모 운용 같은 판단은 계산하지 않는다.
 */

export const MINOR_LIMIT_WON = 20_000_000
export const ADULT_LIMIT_WON = 50_000_000
export const WINDOW_YEARS = 10
export const FILING_MONTHS = 3
export const FILING_CREDIT_RATE = 0.03
/** 10년 경계를 아슬아슬하게 맞추지 않도록 다음 증여 가능일에 더하는 여유 일수 */
export const SAFETY_DAYS = 7
export const MAX_CHILDREN = 4
/** 서버 저장 한도(8KB) 안에 들도록 전체 기록 수를 제한한다 */
export const MAX_GIFTS_TOTAL = 60

export type Giver = 'parent' | 'grandparent'
export type Gift = { id: string; date: string; amount: number; giver: Giver; reported: boolean }
export type Child = { id: string; alias: string; /** 출생 연월 YYYY-MM — 실명·주민번호는 저장하지 않는다 */ birth: string; gifts: Gift[] }
export type ChildGiftState = { children: Child[] }

export const EMPTY_CHILD_STATE: ChildGiftState = { children: [] }

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function addYears(date: string, years: number): string {
  const y = Number(date.slice(0, 4)) + years
  const m = Number(date.slice(5, 7))
  const d = Math.min(Number(date.slice(8, 10)), lastDay(y, m))
  return `${y}-${pad(m)}-${pad(d)}`
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** 증여일이 속한 달의 말일부터 3개월 뒤 — 달력 기준으로 그 달의 말일 */
export function filingDeadline(giftDate: string): string {
  const y = Number(giftDate.slice(0, 4))
  const m = Number(giftDate.slice(5, 7)) + FILING_MONTHS
  const yy = y + Math.floor((m - 1) / 12)
  const mm = ((m - 1) % 12) + 1
  return `${yy}-${pad(mm)}-${pad(lastDay(yy, mm))}`
}

/** 성년이 되는 날(만 19세) — 출생 연월만 알아서 그 달 말일로 보수적으로 잡는다(이 날까지는 미성년 한도) */
export function adultOn(birth: string): string {
  const y = Number(birth.slice(0, 4)) + 19
  const m = Number(birth.slice(5, 7))
  return `${y}-${pad(m)}-${pad(lastDay(y, m))}`
}

export const isAdultOn = (birth: string, date: string): boolean => date > adultOn(birth)
export const limitOn = (birth: string, date: string): number => (isAdultOn(birth, date) ? ADULT_LIMIT_WON : MINOR_LIMIT_WON)

/** asOf 기준 직전 10년(asOf 포함)의 증여 합계 — 부모·조부모 합산 */
export function usedInWindow(gifts: Gift[], asOf: string): number {
  const start = addYears(asOf, -WINDOW_YEARS)
  return gifts.filter((g) => g.date > start && g.date <= asOf).reduce((s, g) => s + g.amount, 0)
}

export type Allowance = { limit: number; used: number; remaining: number; adult: boolean }

export function allowance(child: Child, asOf: string): Allowance {
  const limit = limitOn(child.birth, asOf)
  const used = usedInWindow(child.gifts, asOf)
  return { limit, used, remaining: Math.max(0, limit - used), adult: isAdultOn(child.birth, asOf) }
}

/** 증여세 산출세액 — 과세표준(공제 후) 기준 누진 */
export function giftTax(taxBase: number): number {
  if (!(taxBase > 0)) return 0
  const brackets: Array<[number, number, number]> = [
    [100_000_000, 0.1, 0],
    [500_000_000, 0.2, 10_000_000],
    [1_000_000_000, 0.3, 60_000_000],
    [3_000_000_000, 0.4, 160_000_000],
    [Infinity, 0.5, 460_000_000],
  ]
  const [, rate, deduction] = brackets.find(([cap]) => taxBase <= cap)!
  return Math.round(taxBase * rate - deduction)
}

export type GiftPlan = { withinLimit: boolean; overBy: number; tax: number }

/** 새로 증여하기 전에 — 이 금액이 한도 안인지, 넘으면 대략 얼마인지(자진 신고 3% 공제 반영). 이후 증여분은 따로 합산된다 */
export function planGift(child: Child, date: string, amount: number): GiftPlan {
  const total = usedInWindow(child.gifts, date) + Math.max(0, amount)
  const over = Math.max(0, total - limitOn(child.birth, date))
  const taxableNow = Math.max(0, over)
  const priorOver = Math.max(0, usedInWindow(child.gifts, date) - limitOn(child.birth, date))
  const tax = Math.round((giftTax(taxableNow) - giftTax(priorOver)) * (1 - FILING_CREDIT_RATE))
  return { withinLimit: over === 0, overBy: Math.max(0, over - priorOver), tax: Math.max(0, tax) }
}

export type Relief = { on: string; safeOn: string; amount: number }

/** 지금 쓴 한도가 풀리는 날 — 가장 빠른 회복, 전부 회복(가장 최근 증여 + 10년). 쓴 게 없으면 null */
export function reliefDates(child: Child, today: string): { first: Relief; full: Relief } | null {
  const start = addYears(today, -WINDOW_YEARS)
  const inWindow = child.gifts.filter((g) => g.date > start && g.date <= today).sort((a, b) => a.date.localeCompare(b.date))
  if (!inWindow.length) return null
  const toRelief = (g: Gift): Relief => { const on = addYears(g.date, WINDOW_YEARS); return { on, safeOn: addDays(on, SAFETY_DAYS), amount: g.amount } }
  const first = toRelief(inWindow[0])
  const last = toRelief(inWindow[inWindow.length - 1])
  return { first, full: { ...last, amount: inWindow.reduce((s, g) => s + g.amount, 0) } }
}

export type FilingStatus = { gift: Gift; deadline: string; daysLeft: number; overdue: boolean }

/** 신고하지 않았다고 표시한 증여의 마감 — 세금이 없어도 신고해 두면 나중에 증여 사실을 입증하기 좋다는 안내가 있다 */
export function pendingFilings(child: Child, today: string): FilingStatus[] {
  return child.gifts
    .filter((g) => !g.reported)
    .map((gift) => { const deadline = filingDeadline(gift.date); const daysLeft = daysBetween(today, deadline); return { gift, deadline, daysLeft, overdue: daysLeft < 0 } })
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
}

/** 서버·로컬에서 읽은 값을 안전하게 정리 — 모양이 어긋난 항목은 버리고 개수를 제한한다 */
export function sanitizeChildState(raw: unknown): ChildGiftState {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { children?: unknown }).children)) return EMPTY_CHILD_STATE
  let remaining = MAX_GIFTS_TOTAL
  const children: Child[] = []
  for (const c of (raw as { children: unknown[] }).children.slice(0, MAX_CHILDREN)) {
    if (!c || typeof c !== 'object') continue
    const r = c as Record<string, unknown>
    const birth = typeof r.birth === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(r.birth) ? r.birth : ''
    const id = typeof r.id === 'string' && r.id ? r.id.slice(0, 24) : ''
    if (!birth || !id) continue
    const gifts: Gift[] = []
    for (const g of Array.isArray(r.gifts) ? r.gifts : []) {
      if (remaining <= 0) break
      if (!g || typeof g !== 'object') continue
      const x = g as Record<string, unknown>
      const amount = Number(x.amount)
      if (!isDate(x.date) || !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000_000) continue
      gifts.push({ id: typeof x.id === 'string' && x.id ? x.id.slice(0, 24) : `${x.date}-${amount}`, date: x.date, amount: Math.round(amount), giver: x.giver === 'grandparent' ? 'grandparent' : 'parent', reported: x.reported === true })
      remaining -= 1
    }
    children.push({ id, alias: (typeof r.alias === 'string' ? r.alias.trim().slice(0, 12) : '') || '자녀', birth, gifts: gifts.sort((a, b) => a.date.localeCompare(b.date)) })
  }
  return { children }
}

/** 출생 연월과 오늘로 대략의 만 나이 */
export function approxAge(birth: string, today: string): number {
  const by = Number(birth.slice(0, 4))
  const bm = Number(birth.slice(5, 7))
  const ty = Number(today.slice(0, 4))
  const tm = Number(today.slice(5, 7))
  return Math.max(0, ty - by - (tm < bm ? 1 : 0))
}
