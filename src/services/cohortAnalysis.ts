/**
 * 사용자 비교(코호트) 분석 — 관리자 전용.
 * 봇이 모두에게 같은 종목을 사더라도 시드·투자 성향·전략 방식·체결 시간대가 다르면 결과가 달라질 수 있다.
 * 그 차이를 조건별로 묶어 보여 준다. 순수 함수만 두고 DB 조회는 handlers/ui/cohort-analysis.ts가 맡는다.
 *
 * 주의: 사용자 수와 매도 건수가 적으면 평균 차이는 우연이다. 모든 묶음에 표본 수와 표준오차를 같이 내고,
 * 표본이 부족하거나 차이가 오차 안이면 `reliable=false`로 표시해 전략에 바로 반영하지 않게 한다.
 */

export type CohortTrade = {
  chatId: number
  side: 'BUY' | 'SELL' | 'ADJUST'
  pnlAmount: number | null
  grossAmount: number | null
  tradedAt: string
}

export type CohortUser = {
  chatId: number
  seedCapital: number
  riskProfile: string | null
  strategyMode: string | null
}

export type GroupStats = {
  label: string
  /** 묶음에 속한 사용자 수 */
  users: number
  /** 매도 건수(표본) */
  sells: number
  winRatePct: number | null
  /** 매도 1건당 평균 수익률(%) — 손익 ÷ 매수 원가 */
  avgReturnPct: number | null
  /** 평균의 표준오차(%) */
  stdErrPct: number | null
  /** 표본 30건 이상이고 평균이 오차의 2배를 넘으면 true — 그 외는 우연일 수 있음 */
  reliable: boolean
  /** 전체 평균 대비 차이(%p) */
  vsOverallPct: number | null
}

export type UserRow = {
  chatId: number
  seedCapital: number
  riskProfile: string | null
  strategyMode: string | null
  sells: number
  winRatePct: number | null
  totalPnl: number
  /** 기간 실현손익 ÷ 시드 */
  returnOnSeedPct: number | null
}

export type CohortReport = {
  windowDays: number
  overall: GroupStats
  users: UserRow[]
  bySeed: GroupStats[]
  byRiskProfile: GroupStats[]
  byStrategyMode: GroupStats[]
  /** 매도 체결 시각(한국시간, 시 단위) — 매수 시각이 아님 */
  bySellHour: GroupStats[]
  caveats: string[]
}

export const MIN_RELIABLE_SELLS = 30

export const SEED_BUCKETS: Array<{ label: string; max: number }> = [
  { label: '300만원 미만', max: 3_000_000 },
  { label: '300만~1천만원', max: 10_000_000 },
  { label: '1천만~3천만원', max: 30_000_000 },
  { label: '3천만원 이상', max: Number.POSITIVE_INFINITY },
]

export function seedBucketLabel(seed: number): string {
  if (!(seed > 0)) return '시드 미설정'
  return SEED_BUCKETS.find((b) => seed < b.max)?.label ?? SEED_BUCKETS[SEED_BUCKETS.length - 1].label
}

/** 매도 1건의 수익률(%) — 원가 = 매도금액 − 손익. 원가를 알 수 없으면 null */
export function sellReturnPct(trade: Pick<CohortTrade, 'pnlAmount' | 'grossAmount'>): number | null {
  if (trade.pnlAmount === null || trade.pnlAmount === undefined || trade.grossAmount === null || trade.grossAmount === undefined) return null
  const pnl = Number(trade.pnlAmount)
  const gross = Number(trade.grossAmount)
  if (!Number.isFinite(pnl) || !Number.isFinite(gross)) return null
  const cost = gross - pnl
  if (!(cost > 0)) return null
  return (pnl / cost) * 100
}

/** ISO 시각 → 한국시간 시(0~23) */
export function kstHour(iso: string): number | null {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return new Date(t + 9 * 3_600_000).getUTCHours()
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function stdErr(values: number[]): number | null {
  if (values.length < 2) return null
  const m = mean(values) as number
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance / values.length)
}

function summarize(label: string, users: number, returns: number[], overallMean: number | null): GroupStats {
  const avg = mean(returns)
  const se = stdErr(returns)
  const reliable = returns.length >= MIN_RELIABLE_SELLS && avg !== null && se !== null && Math.abs(avg) > 2 * se
  return {
    label,
    users,
    sells: returns.length,
    winRatePct: returns.length ? (returns.filter((r) => r > 0).length / returns.length) * 100 : null,
    avgReturnPct: avg,
    stdErrPct: se,
    reliable,
    vsOverallPct: avg !== null && overallMean !== null ? avg - overallMean : null,
  }
}

export function buildCohortReport(input: { users: CohortUser[]; trades: CohortTrade[]; windowDays: number }): CohortReport {
  const userById = new Map(input.users.map((u) => [u.chatId, u]))
  const sells = input.trades
    .filter((t) => t.side === 'SELL')
    .map((t) => ({ trade: t, ret: sellReturnPct(t) }))
    .filter((row): row is { trade: CohortTrade; ret: number } => row.ret !== null && userById.has(row.trade.chatId))

  const overallReturns = sells.map((s) => s.ret)
  const overallMean = mean(overallReturns)
  const overallUsers = new Set(sells.map((s) => s.trade.chatId)).size
  const overall = summarize('전체', overallUsers, overallReturns, overallMean)

  const groupBy = (keyOf: (user: CohortUser, trade: CohortTrade) => string | null, order?: string[]): GroupStats[] => {
    const returns = new Map<string, number[]>()
    const members = new Map<string, Set<number>>()
    for (const { trade, ret } of sells) {
      const key = keyOf(userById.get(trade.chatId) as CohortUser, trade)
      if (key === null) continue
      if (!returns.has(key)) { returns.set(key, []); members.set(key, new Set()) }
      returns.get(key)!.push(ret)
      members.get(key)!.add(trade.chatId)
    }
    const keys = [...returns.keys()]
    if (order) keys.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999))
    else keys.sort()
    return keys.map((k) => summarize(k, members.get(k)!.size, returns.get(k)!, overallMean))
  }

  const sellCount = new Map<number, number[]>()
  const pnlSum = new Map<number, number>()
  for (const { trade, ret } of sells) {
    if (!sellCount.has(trade.chatId)) sellCount.set(trade.chatId, [])
    sellCount.get(trade.chatId)!.push(ret)
    pnlSum.set(trade.chatId, (pnlSum.get(trade.chatId) ?? 0) + (Number(trade.pnlAmount) || 0))
  }
  const users: UserRow[] = input.users
    .filter((u) => sellCount.has(u.chatId))
    .map((u) => {
      const rets = sellCount.get(u.chatId) as number[]
      const totalPnl = pnlSum.get(u.chatId) ?? 0
      return {
        chatId: u.chatId,
        seedCapital: u.seedCapital,
        riskProfile: u.riskProfile,
        strategyMode: u.strategyMode,
        sells: rets.length,
        winRatePct: (rets.filter((r) => r > 0).length / rets.length) * 100,
        totalPnl,
        returnOnSeedPct: u.seedCapital > 0 ? (totalPnl / u.seedCapital) * 100 : null,
      }
    })
    .sort((a, b) => (b.returnOnSeedPct ?? -Infinity) - (a.returnOnSeedPct ?? -Infinity))

  const hourOrder = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}시`)
  const caveats = [
    `매도 ${MIN_RELIABLE_SELLS}건 미만이거나 평균이 오차 범위 안이면 "참고 불가"입니다. 이런 차이로 전략을 바꾸지 마세요.`,
    '시간대는 매도 체결 시각입니다. 매수 시각별 성과는 매수·매도를 묶는 로트 이력이 필요해 아직 집계하지 않습니다.',
    '사용자가 적으면 시드·성향·시간대가 서로 겹쳐(예: 시드가 큰 사람이 모두 공격형) 원인을 분리할 수 없습니다.',
    '실계좌 입력 거래는 제외한 가상 매매 기준입니다.',
  ]

  return {
    windowDays: input.windowDays,
    overall,
    users,
    bySeed: groupBy((u) => seedBucketLabel(u.seedCapital), [...SEED_BUCKETS.map((b) => b.label), '시드 미설정']),
    byRiskProfile: groupBy((u) => u.riskProfile || '미설정'),
    byStrategyMode: groupBy((u) => u.strategyMode || '미설정'),
    bySellHour: groupBy((_, t) => { const h = kstHour(t.tradedAt); return h === null ? null : hourOrder[h] }, hourOrder),
    caveats,
  }
}
