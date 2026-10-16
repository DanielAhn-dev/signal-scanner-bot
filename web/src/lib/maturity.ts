/**
 * 만기 예·적금 기록과 만기 때 갈 곳 안내.
 *
 * 새 판단을 만들지 않는다 — 이미 검증한 결론(일시금 평균 우위 C2, 쓸 시점 3년 안은 지수 위험을 지지 않음, 일반계좌 TR 세금 이연)을
 * 쓸 시점 세 구간으로 나눠 만기일에 한 줄로 보여 줄 뿐이다. 수익률 비교·상품 추천·자동 매매는 하지 않는다.
 */

export type MaturityHorizon = 'under3' | '3to5' | 'over5'

export const HORIZON_LABEL: Record<MaturityHorizon, string> = {
  under3: '3년 안에 쓸 돈',
  '3to5': '3~5년 뒤 쓸 돈',
  over5: '5년 넘게 안 쓸 돈',
}

export type Maturity = {
  id: string
  name: string
  /** 만기 때 받을 예상 금액(원) */
  amount: number
  /** 만기일 YYYY-MM-DD */
  date: string
  horizon: MaturityHorizon
  /** 만기금을 이미 처리했다 */
  done?: boolean
  /** 이번 달 투자금에 넣기로 한 달(YYYY-MM)과 금액. 만기금 − 넣은 금액은 투자금에서 빼고 넘긴 몫(다시 예·적금 등). 0이면 넣지 않고 넘김 */
  investedMonth?: string
  investedAmount?: number
}

export type MaturityState = { items: Maturity[] }

export const MAX_ITEMS = 20
const MAX_NAME = 30
const MAX_AMOUNT = 10_000_000_000

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const HORIZONS = new Set<string>(['under3', '3to5', 'over5'])

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const t = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value
}

/** 저장소에서 읽은 값을 믿지 않고 다듬는다. 잘못된 항목은 버리고, 같은 id는 먼저 온 것만 둔다. */
export function sanitizeMaturityState(raw: unknown): MaturityState {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : []
  const seen = new Set<string>()
  const items: Maturity[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const r = entry as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.slice(0, 40) : ''
    const amount = Math.round(Number(r.amount))
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_NAME) : ''
    if (!id || seen.has(id) || !name || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) continue
    if (!validDate(r.date) || typeof r.horizon !== 'string' || !HORIZONS.has(r.horizon)) continue
    seen.add(id)
    const invested = Math.round(Number(r.investedAmount))
    const decided = typeof r.investedMonth === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(r.investedMonth) && Number.isFinite(invested) && invested >= 0 && invested <= amount
    items.push({
      id, name, amount, date: r.date, horizon: r.horizon as MaturityHorizon,
      ...(r.done === true || decided ? { done: true } : {}),
      ...(decided ? { investedMonth: r.investedMonth as string, investedAmount: invested } : {}),
    })
    if (items.length >= MAX_ITEMS) break
  }
  return { items }
}

/** 만기일까지 남은 일수(오늘이면 0, 지났으면 음수). 둘 다 KST 날짜 문자열 */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

export type MaturityStatus = 'overdue' | 'soon' | 'later' | 'done'
/** 이 일수 안에 만기면 '곧' */
export const SOON_DAYS = 14

export function statusOf(item: Maturity, today: string): MaturityStatus {
  if (item.done) return 'done'
  const d = daysUntil(item.date, today)
  return d < 0 ? 'overdue' : d <= SOON_DAYS ? 'soon' : 'later'
}

export function ddayLabel(days: number): string {
  if (days === 0) return '오늘 만기'
  return days > 0 ? `D-${days}` : `${-days}일 지남`
}

/** 처리 안 한 것은 만기일 순(지난 것이 맨 위), 처리한 것은 맨 아래 */
export function sortMaturities(items: Maturity[]): Maturity[] {
  return [...items].sort((a, b) => Number(!!a.done) - Number(!!b.done) || a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}

export type MaturityAdvice = {
  /** 갈 곳 한 줄 */
  where: string
  /** 만기 때 할 일 */
  steps: string[]
  /** 왜 그런지 — 검증 근거 한 줄 */
  why: string
}

/** 쓸 시점별 안내. 어느 구간이든 수익을 보장하지 않으며, 같은 규칙을 만기마다 반복해 판단을 줄이는 것이 목적이다. */
export function adviceFor(horizon: MaturityHorizon): MaturityAdvice {
  if (horizon === 'under3') {
    return {
      where: '지수에 넣지 않고 원금이 지켜지는 곳(예금·CD금리·파킹 ETF)에 둡니다',
      steps: ['쓸 날짜에 맞춰 만기가 오는 상품으로 다시 맡깁니다', '이 돈은 지수 매수 계획에 넣지 않습니다'],
      why: '지수는 길게 보면 올라도 3년 안에는 손실로 끝나는 구간이 실제로 있습니다.',
    }
  }
  if (horizon === '3to5') {
    return {
      where: '지수에는 일부(절반 안팎까지)만 넣고 나머지는 원금이 지켜지는 곳에 둡니다',
      steps: ['얼마까지 넣을지는 계획 점검의 "감내 낙폭"으로 정합니다', '지수로 가는 몫은 입금 당일 KODEX 200TR(일반계좌)로 한 번에 넣습니다'],
      why: '폭락 직전에 시작해도 36개월 뒤에는 대부분 플러스였지만(C5) 도중 평가손실이 -22~-45%였습니다. 쓸 때가 그 구간이면 곤란합니다.',
    }
  }
  return {
    where: 'KODEX 200TR(일반계좌)에 입금된 날 한 번에 넣습니다',
    steps: [
      '연금저축·IRP·ISA 납입 한도를 먼저 채웠는지 확인합니다',
      '입금 당일 또는 다음 영업일에 사고, 하루 이틀 미루지 않습니다',
      '지수가 급락해 있어도 규칙을 바꾸지 않습니다',
    ],
    why: '시점을 맞추는 것은 검증에서 효과가 없었고(C2·C3·C4) 일시금이 평균적으로 낫습니다. 일반계좌에서는 TR이 분배금 과세를 미뤄 세후 연 0.4%p 정도 유리했습니다.',
  }
}

/** 안내에 맞춘 '투자금에 넣을 금액' 기본값: 5년 넘게 안 쓸 돈은 전부, 3~5년은 절반(만원 단위), 3년 안에 쓸 돈은 0 */
export function suggestedInvest(item: Maturity): number {
  if (item.horizon === 'over5') return item.amount
  if (item.horizon === '3to5') return Math.round(item.amount / 2 / 10_000) * 10_000
  return 0
}

/** 그 달(YYYY-MM)까지 만기가 왔는데 아직 처리하지 않은 것 — 이번 달 투자금에서 넣을지 정한다 */
export function maturitiesDue(items: Maturity[], month: string): Maturity[] {
  return sortMaturities(items).filter((i) => !i.done && i.date.slice(0, 7) <= month)
}

/** 그 달 투자금에서 넣을지 정한 것(넣지 않고 넘긴 것 포함) — 되돌리기용 */
export function maturitiesDecidedIn(items: Maturity[], month: string): Maturity[] {
  return items.filter((i) => i.investedMonth === month)
}

export function summarizeUpcoming(items: Maturity[]): { count: number; amount: number; next: Maturity | null } {
  const open = sortMaturities(items).filter((i) => !i.done)
  return { count: open.length, amount: open.reduce((s, i) => s + i.amount, 0), next: open[0] ?? null }
}

export function newMaturityId(now: number = Date.now()): string {
  return `m${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}
