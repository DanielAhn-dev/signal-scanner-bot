import { ACCUMULATE_ASOF, INDEX_ETF_CANDIDATES, KODEX200_MONTHLY, type IndexEtfCandidate } from '../data/accumulateData'

/**
 * 모아가기(적립) 계산 — 과거 실제 가격으로 "그렇게 모았다면"의 분포를 보여 준다. 미래 예측이 아니다.
 * 가격: KODEX 200 월말 수정주가(분배금 반영 = 세전 재투자 수익). 모든 코스피200 추종 상품의 장기 이력 대용이다.
 * 근거: scripts/research/validate_200_etf_choice.py, simulate_dca_200.py (2026-10-02)
 */

/** 분배금 과세율 (배당소득세, 지방세 포함) */
export const DIST_TAX = 0.154

/**
 * 일반형(KODEX 200 등)이 분배금 세금 때문에 TR보다 뒤처지는 연 수익률.
 * 2021-10~2026-10 실제 분배 20건 기준: 세후 재투자 연 25.57% vs 세전 25.94% → 약 0.3%/년.
 */
export const PLAIN_TAX_DRAG_ANNUAL = 0.003

export const MAX_YEARS = 15
const MIN_STARTS = 12
/** 거래일 기준 한 달 */
const TRADING_DAYS_PER_MONTH = 21
const WEEKS_PER_MONTH = 52 / 12

export type Freq = 'day' | 'week' | 'month'

export function toMonthly(amount: number, freq: Freq): number {
  if (!(amount > 0)) return 0
  return Math.round(freq === 'day' ? amount * TRADING_DAYS_PER_MONTH : freq === 'week' ? amount * WEEKS_PER_MONTH : amount)
}

// ── 적립 시뮬레이션 ────────────────────────────────────────

export type SimInput = {
  /** 매달 넣는 금액(원) */
  monthly: number
  years: number
  /** 분배금 세금으로 줄어드는 연 수익률 (TR=0, 일반=PLAIN_TAX_DRAG_ANNUAL) */
  annualDrag?: number
  /** 처음부터 가진 성장 자산(원) */
  lump?: number
  /** 가격 시리즈 (테스트용 주입, 기본은 KODEX 200 월말 수정주가) */
  prices?: number[]
}

export type SimResult = {
  starts: number
  months: number
  paid: number[]
  worst: number[]
  p10: number[]
  median: number[]
  p90: number[]
  /** 총납입 대비 최종 배율, 오름차순 */
  finalRatios: number[]
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function dragged(prices: number[], annualDrag: number): number[] {
  const monthlyKeep = 1 - annualDrag / 12
  const out = [prices[0]]
  for (let i = 1; i < prices.length; i += 1) out.push(out[i - 1] * (prices[i] / prices[i - 1]) * monthlyKeep)
  return out
}

export function historyPrices(): number[] {
  return KODEX200_MONTHLY.map(([, p]) => p)
}

/** 모든 월 시작점에서 매달 같은 금액을 넣었을 때의 평가금 경로 분포 */
export function simulateDca(input: SimInput): SimResult | null {
  const years = Math.min(MAX_YEARS, Math.max(1, Math.round(input.years)))
  const n = years * 12
  const monthly = Math.max(0, input.monthly)
  const lump = Math.max(0, input.lump ?? 0)
  const raw = input.prices ?? historyPrices()
  if (raw.length < n + MIN_STARTS + 1) return null
  const q = dragged(raw, input.annualDrag ?? 0)
  const starts = q.length - n
  const byStep: number[][] = Array.from({ length: n + 1 }, () => [])
  const finals: number[] = []
  for (let s = 0; s < starts; s += 1) {
    let invUnits = 0
    for (let i = 0; i <= n; i += 1) {
      // i개월 뒤 평가금: 매달 초 한 번씩 i번 넣은 단위 + 처음 가진 자산
      const value = monthly * q[s + i] * invUnits + lump * (q[s + i] / q[s])
      byStep[i].push(value)
      if (i < n) invUnits += 1 / q[s + i]
    }
    const paid = monthly * n + lump
    finals.push(paid > 0 ? byStep[n][s] / paid : 0)
  }
  const sortedSteps = byStep.map((v) => [...v].sort((a, b) => a - b))
  return {
    starts,
    months: n,
    paid: Array.from({ length: n + 1 }, (_, i) => monthly * i + lump),
    worst: sortedSteps.map((v) => v[0]),
    p10: sortedSteps.map((v) => quantile(v, 0.1)),
    median: sortedSteps.map((v) => quantile(v, 0.5)),
    p90: sortedSteps.map((v) => quantile(v, 0.9)),
    finalRatios: finals.sort((a, b) => a - b),
  }
}

export type SimSummary = {
  paid: number
  worst: number
  p10: number
  median: number
  p90: number
  lossPct: number
  over20Pct: number
}

export function summarize(r: SimResult): SimSummary {
  const last = r.months
  const count = r.finalRatios.length
  const pctOf = (pred: (x: number) => boolean) => (r.finalRatios.filter(pred).length / count) * 100
  return {
    paid: r.paid[last],
    worst: r.worst[last],
    p10: r.p10[last],
    median: r.median[last],
    p90: r.p90[last],
    lossPct: pctOf((x) => x < 1),
    over20Pct: pctOf((x) => x >= 1.2),
  }
}

/** 원금 대비 +20%에 처음 닿기까지 걸린 개월 (모든 시작점, 최대 10년까지 봄) */
export function monthsToGain(opts: { gain?: number; prices?: number[]; annualDrag?: number } = {}) {
  const gain = 1 + (opts.gain ?? 0.2)
  const q = dragged(opts.prices ?? historyPrices(), opts.annualDrag ?? 0)
  const MAX = 120
  const MIN_MONTHS = 6
  const reached: number[] = []
  let total = 0
  for (let s = 0; s < q.length - MIN_MONTHS; s += 1) {
    total += 1
    let invUnits = 0
    for (let i = 1; i <= Math.min(MAX, q.length - 1 - s); i += 1) {
      invUnits += 1 / q[s + i - 1]
      if (i >= MIN_MONTHS && (q[s + i] * invUnits) / i >= gain) {
        reached.push(i)
        break
      }
    }
  }
  reached.sort((a, b) => a - b)
  return {
    total,
    reachedPct: total ? (reached.length / total) * 100 : 0,
    median: reached.length ? quantile(reached, 0.5) : null,
    p25: reached.length ? quantile(reached, 0.25) : null,
    p75: reached.length ? quantile(reached, 0.75) : null,
    max: reached.length ? reached[reached.length - 1] : null,
  }
}

/** 목표 금액을 years년 뒤 갖기 위해 필요한 월 적립 — 과거 분포의 하위10%(보수)와 중앙값 기준 */
export function requiredMonthly(opts: { target: number; years: number; annualDrag?: number; lump?: number; prices?: number[] }) {
  const sim = simulateDca({ monthly: 1, years: opts.years, annualDrag: opts.annualDrag, lump: 0, prices: opts.prices })
  if (!sim) return null
  const n = sim.months
  const lump = Math.max(0, opts.lump ?? 0)
  // 처음 가진 자산은 적립금과 다른 경로로 자라므로 따로 시뮬레이션해 같은 분위수의 배율을 쓴다
  const lumpSim = lump > 0 ? simulateDca({ monthly: 0, lump: 1, years: opts.years, annualDrag: opts.annualDrag, prices: opts.prices }) : null
  const need = (q: number) => {
    const ratio = quantile(sim.finalRatios, q)
    const grownLump = lumpSim ? lump * quantile(lumpSim.finalRatios, q) : 0
    return Math.max(0, (opts.target - grownLump) / (n * ratio))
  }
  return { conservative: Math.round(need(0.1)), typical: Math.round(need(0.5)), years: n / 12 }
}

// ── 적립 대상 추천 ─────────────────────────────────────────

export type Goal = 'growth' | 'income'

const MIN_CAP_EOK = 10_000 // 순자산 1조원
const MIN_TRADING_MIL = 5_000 // 일 거래대금 50억원
const MIN_LISTED_YEARS = 3
/** 보수가 이만큼(%p) 이상 차이 나야 규모가 작은 쪽을 고른다 */
const FEE_MARGIN_PCT = 0.1

function yearsSince(yyyymmdd: string, asOf: string): number {
  const a = Date.parse(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`)
  const b = Date.parse(asOf)
  return (b - a) / (365.25 * 86_400_000)
}

export type Recommendation = {
  pick: IndexEtfCandidate | null
  eligible: IndexEtfCandidate[]
  reasons: string[]
}

/**
 * 같은 지수를 따라가므로 수익률 순위가 아니라 구조로 고른다: 규모·거래대금·상장기간 관문을 넘은 상품 중
 * 최저 보수와 차이가 크지 않으면 순자산이 가장 큰 쪽(폐지·괴리 위험이 낮다).
 */
export function recommendCandidate(goal: Goal, cands: IndexEtfCandidate[] = INDEX_ETF_CANDIDATES, asOf = ACCUMULATE_ASOF): Recommendation {
  const kind = goal === 'growth' ? 'tr' : 'plain'
  const eligible = cands
    .filter((c) => c.kind === kind && c.feePct != null)
    .filter((c) => c.marketCapEok >= MIN_CAP_EOK && c.tradingValueMil >= MIN_TRADING_MIL && yearsSince(c.listed, asOf) >= MIN_LISTED_YEARS)
    .sort((a, b) => b.marketCapEok - a.marketCapEok)
  if (!eligible.length) return { pick: null, eligible, reasons: [] }
  const minFee = Math.min(...eligible.map((c) => c.feePct as number))
  const pick = eligible.find((c) => (c.feePct as number) <= minFee + FEE_MARGIN_PCT + 1e-9) ?? eligible[0]
  const reasons = [
    `순자산 ${(pick.marketCapEok / 10_000).toFixed(1)}조원 — 같은 종류 중 ${pick === eligible[0] ? '가장 큽니다' : '상위입니다'}`,
    `일 거래대금 약 ${Math.round(pick.tradingValueMil / 100)}억원 · 상장 ${Math.floor(yearsSince(pick.listed, asOf))}년`,
    `보수 연 ${pick.feePct}%${pick.feePct === minFee ? ' (최저)' : ` — 최저(${minFee}%)와 ${(((pick.feePct as number) - minFee)).toFixed(3)}%p 차이라 규모를 우선했습니다`}`,
  ]
  return { pick, eligible, reasons }
}

/** 후보 지표가 낡았는지 — 보수·시총은 바뀐다 */
export function candidateDataAgeDays(today: Date = new Date(), asOf = ACCUMULATE_ASOF): number {
  return Math.floor((today.getTime() - Date.parse(asOf)) / 86_400_000)
}

// ── 지금 상황 가이드 ───────────────────────────────────────

export type Candle = { date: string; close: number }
export type GuideState = 'stale' | 'short' | 'drop' | 'rally' | 'normal'

export type SituationGuide = {
  state: GuideState
  title: string
  text: string
  note: string
  drawdownPct: number | null
  gain12mPct: number | null
  lastDate: string | null
}

const DROP_DD = -0.15
const RALLY_NEAR_HIGH = -0.03
const RALLY_GAIN_12M = 0.3
const STALE_DAYS = 7

/**
 * 수익을 올리는 규칙이 아니라 흔들리지 않게 돕는 안내다. 근거: 코스피 1996~ 검증에서
 * 하락 때 몰아 넣기는 꾸준히 넣는 것과 중앙값이 같았고(승률 13~90%로 시기마다 갈림), 오를 때 줄이면 상승을 덜 탔다.
 */
export function situationGuide(candles: Candle[], today: Date = new Date()): SituationGuide {
  const rows = candles
    .filter((c) => c && Number.isFinite(c.close) && c.close > 0 && c.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  const base = { drawdownPct: null, gain12mPct: null, lastDate: rows.length ? rows[rows.length - 1].date.slice(0, 10) : null }
  if (rows.length < 60) {
    return { state: 'short', title: '판단할 시세가 부족합니다', text: '시세가 충분히 쌓이기 전에는 상황 안내를 하지 않습니다. 정한 금액을 그대로 이어가세요.', note: '', ...base }
  }
  const last = rows[rows.length - 1]
  const ageDays = Math.floor((today.getTime() - Date.parse(last.date.slice(0, 10))) / 86_400_000)
  if (ageDays > STALE_DAYS) {
    return { state: 'stale', title: '시세가 오래되어 안내를 보류합니다', text: `마지막 시세가 ${ageDays}일 전(${last.date.slice(0, 10)})입니다. 낡은 가격으로 판단하지 않도록 상황 안내를 멈췄습니다.`, note: '', ...base }
  }
  const window = rows.slice(-250)
  const high = Math.max(...window.map((c) => c.close))
  const dd = last.close / high - 1
  const back = rows.length > 250 ? rows[rows.length - 251] : rows[0]
  const gain12 = rows.length >= 200 ? last.close / back.close - 1 : null
  const common = { drawdownPct: dd * 100, gain12mPct: gain12 == null ? null : gain12 * 100, lastDate: last.date.slice(0, 10) }
  if (dd <= DROP_DD) {
    return {
      state: 'drop',
      title: `고점 대비 ${(dd * 100).toFixed(1)}% 내려와 있습니다`,
      text: '멈추지 말고 정한 금액을 그대로 이어가세요. 여유자금이 있으면 추가로 넣는 것은 선택입니다. 평단은 낮아지지만, 과거 검증에서 몰아 넣기가 꾸준히 넣는 것보다 낫다는 근거는 일관되지 않았습니다.',
      note: '이 안내는 수익을 올리는 규칙이 아니라 중단·충동 매매를 막기 위한 것입니다.',
      ...common,
    }
  }
  if (dd >= RALLY_NEAR_HIGH && gain12 != null && gain12 >= RALLY_GAIN_12M) {
    return {
      state: 'rally',
      title: `최근 1년 ${(gain12 * 100).toFixed(0)}% 올라 고점 부근입니다`,
      text: '오른다고 줄일 필요는 없습니다. 줄이면 그만큼 상승을 덜 타고, 이후 하락을 피한다는 근거도 없었습니다. 이미 많이 올랐다는 이유로 적립을 멈추지 마세요.',
      note: '낙폭이 걱정되는 분만 자산 비중을 정해 두고 벗어날 때 조정하세요(수익이 아니라 낙폭을 줄이는 도구, 과거 중앙값은 2~4% 낮았습니다).',
      ...common,
    }
  }
  return {
    state: 'normal',
    title: '평소대로 이어가면 됩니다',
    text: '특별한 신호가 없습니다. 정한 날짜에 정한 금액을 넣는 것이 전부입니다.',
    note: '',
    ...common,
  }
}

// ── 사용자 기록 ───────────────────────────────────────────

export type AccumulateState = {
  goal: Goal
  /** 직접 지정한 대상. 없으면 추천을 따른다 */
  target: { code: string; name: string } | null
  /** 받은 분배금(세후 입금액) [YYYY-MM, 원] */
  received: Array<[string, number]>
  /** 실제 적립한 금액 [YYYY-MM, 원] */
  deposits: Array<[string, number]>
  /** 가장 최근에 증권사 앱에서 확인한 평가금 */
  valuation: { ym: string; value: number } | null
  /** 성장 자산을 얼마나 이미 갖고 있는지 */
  lump: number
}

export const EMPTY_STATE: AccumulateState = { goal: 'growth', target: null, received: [], deposits: [], valuation: null, lump: 0 }
const MAX_RECORDS = 60

export function upsertMonth(list: Array<[string, number]>, ym: string, amount: number): Array<[string, number]> {
  const rest = list.filter(([m]) => m !== ym)
  const next = amount > 0 ? [...rest, [ym, Math.round(amount)] as [string, number]] : rest
  return next.sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-MAX_RECORDS)
}

/**
 * 월 분배금 평균 — 진행 중인 달은 일부만 들어와 있으므로 평균에서 뺀다(월초/중순/월말에 나눠 입금된다).
 * 완료된 최근 3개월 평균. 기록이 없으면 null.
 */
export function averageReceived(received: Array<[string, number]>, currentYm: string) {
  const done = received.filter(([m]) => m < currentYm).slice(-3)
  const partial = received.find(([m]) => m === currentYm)?.[1] ?? null
  if (!done.length) return { avg: null as number | null, months: 0, partial }
  return { avg: Math.round(done.reduce((s, [, v]) => s + v, 0) / done.length), months: done.length, partial }
}

export function trackSummary(state: AccumulateState) {
  const paid = state.deposits.reduce((s, [, v]) => s + v, 0) + Math.max(0, state.lump)
  const value = state.valuation?.value ?? null
  return {
    paid,
    value,
    gain: value == null ? null : value - paid,
    gainPct: value == null || paid <= 0 ? null : (value / paid - 1) * 100,
  }
}

export function currentYmKst(now: Date = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).slice(0, 7)
}
