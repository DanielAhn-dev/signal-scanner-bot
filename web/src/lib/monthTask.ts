/**
 * 홈 '이번 달 할 일' — 실제 계좌(내 계좌)에서 이번 달에 무엇을 몇 주 살지와 답한 상태.
 * 원칙(2026-10-19): 할 일은 언제나 실제 계좌에만 있다. 가상 계좌는 계획대로 자동으로 사서 사용자 할 일이 없다.
 * 증권사 연동이 없으므로 넣은 돈은 계획 금액이라고 보고 계산하고, 다르면 사용자가 고친다.
 * 답은 user-state 'accumulate'.tasks[YYYY-MM]에 남는다. 산 기록 자체는 실계좌 거래(/api/ui/virtual-trade)로 남긴다.
 */

export type MonthTaskStatus = 'bought' | 'skipped' | 'later'

export type MonthTaskRecord = {
  status: MonthTaskStatus
  code?: string
  name?: string
  qty?: number
  price?: number
  /** 그달 넣은 돈(원) — 산 금액이 아니라 계좌에 넣은 돈 */
  amount?: number
  at: string
}

export type MonthTaskPhase = 'upcoming' | 'due' | MonthTaskStatus

export type MonthTaskView = {
  ym: string
  /** 이번 달 넣는 날 YYYY-MM-DD */
  dueDate: string
  phase: MonthTaskPhase
  record: MonthTaskRecord | null
  /** 한 번도 답한 적이 없으면 첫 달 — '못 함' 대신 '다음 달부터 시작'을 보여 준다 */
  firstTime: boolean
  /** 넣을 돈으로 살 수 있는 주수 (가격을 모르면 null) */
  qty: number | null
  /** 사고 남는 돈 */
  leftover: number | null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** KST 오늘 YYYY-MM-DD */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

/** 그달의 넣는 날 — 달마다 날 수가 달라도 1~28만 쓰므로 그대로 */
export function dueDateOf(ym: string, depositDay: number): string {
  const d = Math.min(28, Math.max(1, Math.trunc(depositDay) || 1))
  return `${ym}-${pad(d)}`
}

export function nextYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`
}

export function buyQuantity(amount: number, price: number | null): { qty: number | null; leftover: number | null } {
  if (!price || price <= 0 || !(amount > 0)) return { qty: null, leftover: null }
  const qty = Math.floor(amount / price)
  return { qty, leftover: Math.round(amount - qty * price) }
}

export function monthTaskView(input: {
  today: string
  depositDay: number
  amount: number
  price: number | null
  tasks: Record<string, MonthTaskRecord> | undefined
}): MonthTaskView {
  const ym = input.today.slice(0, 7)
  const dueDate = dueDateOf(ym, input.depositDay)
  const tasks = input.tasks ?? {}
  const record = tasks[ym] ?? null
  const firstTime = Object.keys(tasks).length === 0
  const phase: MonthTaskPhase = record ? record.status : input.today < dueDate ? 'upcoming' : 'due'
  const { qty, leftover } = buyQuantity(input.amount, input.price)
  return { ym, dueDate, phase, record, firstTime, qty, leftover }
}

/** '[실제] 11월' 같은 짧은 달 이름 */
export function monthLabel(ym: string): string {
  return `${Number(ym.slice(5, 7))}월`
}

/** 서버 '내 모으기'가 내려 주는 이번 달 실계좌 매수 한 건 */
export type MonthBuy = { code: string; quantity: number; price: number; tradedAt: string; broker: string | null; account: string | null; memo: string | null }

export type MonthBuyGroup = { code: string; qty: number; avgPrice: number; amount: number; lastDate: string; account: string }

/**
 * 이번 달 실계좌 매수를 종목별로 묶는다 — 포트폴리오에서 먼저 적은 매수를 홈 카드가 알아보고
 * '이걸로 완료'로 답만 남기게(같은 매수를 두 번 기록하지 않게). 고른 상품을 맨 앞에.
 */
export function groupMonthBuys(buys: MonthBuy[], productCode: string | null): MonthBuyGroup[] {
  const by = new Map<string, MonthBuyGroup>()
  for (const b of buys) {
    if (!(b.quantity > 0) || !(b.price > 0)) continue
    const g = by.get(b.code) ?? { code: b.code, qty: 0, avgPrice: 0, amount: 0, lastDate: '', account: '' }
    g.qty += b.quantity
    g.amount += b.quantity * b.price
    g.avgPrice = g.amount / g.qty
    if (b.tradedAt > g.lastDate) {
      g.lastDate = b.tradedAt
      g.account = [b.broker, b.account].filter(Boolean).join(' · ')
    }
    by.set(b.code, g)
  }
  return [...by.values()].sort((a, b) => Number(b.code === productCode) - Number(a.code === productCode) || b.amount - a.amount)
}
