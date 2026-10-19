import { MIX_ASOF } from '../data/mixData'
import { KOSPI_HISTORY, maxSimYears, simulateDca, type HistorySeries } from './accumulate'
import { simulateMix } from './mix'

/**
 * 내 계획 구성(mix) — 어떤 지수에 어떤 비중으로 모으나 (docs/plan-screen-map-2026-10-19.md 3·5절).
 * 저장 형식·검증은 서버 src/services/userPlan.ts(MixEntry·normalizeMix)가 정본이다. 웹은 서버 파일을 import하지 않으므로 타입만 같게 둔다.
 * 정하지 않은 계정은 코스피200 100%로 읽는다.
 */
export type MixIndex = 'kospi200' | 'sp500' | 'nasdaq100'
export type MixEntry = {
  index: MixIndex
  weight: number
  product: { code: string; name: string } | null
  account: { broker: string; account: string } | null
}

export const MIX_INDEX_LABEL: Record<MixIndex, string> = { kospi200: '코스피200', sp500: 'S&P500', nasdaq100: '나스닥100' }
export const DEFAULT_PLAN_MIX: MixEntry[] = [{ index: 'kospi200', weight: 1, product: null, account: null }]

export type PlanMixPreset = { key: string; label: string; weights: Partial<Record<MixIndex, number>> }

/**
 * 처음 고르는 사람을 위한 세 가지. 순서는 이력이 긴 순서(순위 아님).
 * 나스닥100 단독은 넣지 않는다 — 이력이 가장 좋았던 14년뿐이고 한 업종에 몰린다(직접 정하기로만).
 */
export const PLAN_MIX_PRESETS: PlanMixPreset[] = [
  { key: 'kospi', label: '국내만', weights: { kospi200: 1 } },
  { key: 'half', label: '국내·해외 반반', weights: { kospi200: 0.5, sp500: 0.5 } },
  { key: 'three', label: '셋 같은 비중', weights: { kospi200: 1 / 3, sp500: 1 / 3, nasdaq100: 1 / 3 } },
]
/**
 * 처음 오는 사람에게 먼저 보여 주는 구성. 근거는 과거 수익이 아니라 "한 나라에 몰지 않기"다 —
 * 과거 수익으로 고르면 가장 좋았던 구간의 지수(나스닥100)가 1등이 된다.
 */
export const BEGINNER_PRESET_KEY = 'half'

export function presetEntries(p: PlanMixPreset, keepFrom: MixEntry[] = []): MixEntry[] {
  return (Object.entries(p.weights) as Array<[MixIndex, number]>).map(([index, weight]) => {
    const prev = keepFrom.find((e) => e.index === index)
    return { index, weight, product: prev?.product ?? null, account: prev?.account ?? null }
  })
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005

/** 지수와 비중이 같은 프리셋 (상품·계좌는 보지 않는다). 없으면 null = 직접 정한 구성 */
export function presetKeyOf(mix: MixEntry[]): string | null {
  for (const p of PLAN_MIX_PRESETS) {
    const ws = Object.entries(p.weights) as Array<[MixIndex, number]>
    if (ws.length === mix.length && ws.every(([i, w]) => mix.some((e) => e.index === i && near(e.weight, w)))) return p.key
  }
  return null
}

export function isKospiOnly(mix: MixEntry[]): boolean {
  return mix.length === 1 && mix[0].index === 'kospi200'
}

/** "코스피200 50 · S&P500 50" — 비중은 % 정수 */
export function mixLabel(mix: MixEntry[]): string {
  return mix.map((e) => `${MIX_INDEX_LABEL[e.index]} ${Math.round(e.weight * 100)}`).join(' · ')
}

/** 지수·비중·상품·계좌가 모두 같은가 — 저장할 것이 남았는지 */
export function sameMix(a: MixEntry[], b: MixEntry[]): boolean {
  if (a.length !== b.length) return false
  return a.every((e) => {
    const o = b.find((x) => x.index === e.index)
    return !!o && near(o.weight, e.weight) && o.product?.code === e.product?.code && o.account?.broker === e.account?.broker && o.account?.account === e.account?.account
  })
}

function prevYm(ym: string): string {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(4))
  return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, '0')}`
}

/**
 * 구성의 월말 이력 — 매달 비중대로 다시 맞춘 값(섞어보기 simulateMix의 월 재조정과 같은 계산).
 * 코스피200 100%는 지금과 같은 KODEX 200 이력을 그대로 쓴다. 지수마다 이력 시작이 달라 가장 짧은 지수가 시작을 정한다.
 * 해외지수 세금·보수 몫(dragPct)은 simulateMix가 이미 뺐으므로 여기서는 0이다.
 */
export function mixHistory(mix: MixEntry[]): HistorySeries | null {
  if (isKospiOnly(mix)) return KOSPI_HISTORY
  const weights: Record<string, number> = {}
  for (const e of mix) weights[e.index] = e.weight * 100
  const r = simulateMix(weights, 'month')
  if (!r) return null
  const months = r.yms.slice(1)
  const monthly: Array<[string, number]> = r.curve.map((v, i) => [i === 0 ? prevYm(months[0]) : months[i - 1], Math.round(v * 100_000) / 100])
  return { id: 'mix', name: mixLabel(mix), source: '섞어보기 이력(매달 비중 맞춤)', asOf: MIX_ASOF, dragPct: 0, monthly }
}

export type MixStats = {
  /** 이력 시작 YYYY */
  fromYear: string
  /** 적립 결과를 본 기간(년) */
  years: number
  /** 그 기간 매달 넣었을 때 끝 평가금 / 넣은 돈 — 보통(중앙값)·운 나쁨(하위 10%) */
  typical: number
  low: number
  /** 한 번에 넣었다면 월말 기준 최대 낙폭(음수, %) */
  mddPct: number
}

/** 이력 시작 YYYYMM */
export function mixHistoryStart(mix: MixEntry[]): string | null {
  return mixHistory(mix)?.monthly[0][0] ?? null
}

/**
 * 프리셋 한 줄에 쓰는 숫자 — 순위가 아니라 결과 범위·낙폭을 같이 보여 주려는 것.
 * since(YYYYMM)를 주면 그달부터 잘라 계산한다: 프리셋끼리는 같은 기간으로 맞춰야 한다 —
 * 이력이 짧은 구성(나스닥100 포함, 2010~)만 2008년 금융위기를 건너뛰어 낙폭이 작아 보였다.
 * until도 같은 이유 — 코스피200 이력은 섞어보기 이력(MIX_ASOF)보다 최근 달까지 있다.
 */
export function mixStats(mix: MixEntry[], opts: { years?: number; since?: string; until?: string } = {}): MixStats | null {
  const h = mixHistory(mix)
  if (!h) return null
  const series = h.monthly.filter(([m]) => (!opts.since || m >= opts.since) && (!opts.until || m <= opts.until))
  if (series.length < 2) return null
  const prices = series.map(([, p]) => p)
  const y = Math.min(opts.years ?? 10, maxSimYears(series.length))
  const sim = y > 0 ? simulateDca({ monthly: 1, years: y, prices }) : null
  if (!sim) return null
  const q = (f: number) => sim.finalRatios[Math.floor((sim.finalRatios.length - 1) * f)]
  let peak = prices[0]
  let mdd = 0
  for (const p of prices) { peak = Math.max(peak, p); mdd = Math.min(mdd, p / peak - 1) }
  return { fromYear: series[0][0].slice(0, 4), years: y, typical: q(0.5), low: q(0.1), mddPct: mdd * 100 }
}

/** 프리셋끼리 비교할 같은 기간 — 가장 늦게 시작하는 구성부터 섞어보기 이력 끝(MIX_ASOF)까지 */
export function presetCompareWindow(): { since: string; until: string } {
  const since = PLAN_MIX_PRESETS.map((p) => mixHistoryStart(presetEntries(p)) ?? '').sort().at(-1) ?? ''
  return { since, until: MIX_ASOF.replace('-', '') }
}
