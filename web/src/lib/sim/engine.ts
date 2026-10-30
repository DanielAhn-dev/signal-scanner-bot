import { MIX_ASSETS, type MixAsset } from '../../data/mixData'
import { normalize, type Rebalance, type Weights } from '../mix'

/**
 * 시뮬레이터 계산 엔진 — 구성(비중) · 기간 · 일시금/월 적립 · 리밸런싱을 한 번에 넣어 과거 실제 월말 가격으로 따라간다.
 * 미래 예측이 아니다. 계획: docs/plan-simulator-redesign-2026-10-22.md 5절.
 *
 * 기존 계산과 같은 규칙을 지킨다(불변 테스트 lib/sim/engine.test.ts):
 * - 비중·리밸런싱·비용은 섞어보기 simulateMix와 같다 — 월 수익률에서 dragPct/12를 빼고, 되돌린 비중의 0.1%를 비용으로 뺀다.
 *   'year'는 연도의 마지막 달(기간의 마지막 달 포함)에 되돌린다.
 * - 적립 시점은 모아가기 simulatePeriod와 같다 — t번째 달 가격으로 넣고 같은 달 가격으로 평가한다.
 *   value[t]는 그 달 넣기 전 평가금이고, 마지막 달은 평가만 한다.
 * - dragPct 적용 방식만 다르다: simulatePeriod는 (1+r)(1−d/12), 여기는 simulateMix처럼 1+r−d/12. 차이는 월 r·d/12 수준.
 */

export type SimRebalance = Rebalance | 'cashflow'

export type SimPlanInput = {
  /** 자산 id → 비중(어떤 단위든 비율로 환산) */
  weights: Weights
  /** YYYYMM. 비우면 구성의 공통 이력 처음/끝 */
  startYm?: string
  endYm?: string
  /** 시작월에 한 번에 넣는 돈 */
  lump?: number
  /** 매달 넣는 돈 (시작월부터, 마지막 달 전까지) */
  monthly?: number
  /** 12개월마다 매달 넣는 돈을 늘리는 비율 (0.05 = 5%, 목표 트래커 goalReach와 같은 규칙) */
  monthlyRaisePct?: number
  /** 'cashflow' = 되돌리지 않고 새 돈을 모자란 자산에 먼저 넣는다 */
  rebalance?: SimRebalance
  /** 되돌린 비중 1당 비용 (기본 0.001 = 섞어보기와 같음) */
  rebalanceCost?: number
  assets?: MixAsset[]
}

export type SimPlanStats = {
  endValue: number
  paidTotal: number
  /** 끝 평가금 / 넣은 돈 (넣은 돈이 0이면 0) */
  ratio: number
  /** 내 돈 기준 연수익률(금전가중, IRR). 계산할 수 없으면 null */
  irr: number | null
  /** 구성 자체의 연수익률(시간가중) — 넣는 시점과 무관 */
  cagr: number
  /** 구성 자체의 최대 낙폭(시간가중 지수 기준, 음수) */
  mdd: number
  /** 넣은 돈 대비 가장 깊었던 지점(%, 음수). 한 번도 원금 아래로 내려가지 않았으면 null */
  trough: { pct: number; ym: string; step: number } | null
  /** 가장 깊었던 지점에서 다시 원금 이상이 되기까지 개월. 기간 안에 못 돌아왔으면 null */
  recoveryMonths: number | null
  /** 평가금이 넣은 돈보다 적었던 가장 긴 연속 개월 */
  longestUnderwaterMonths: number
}

export type SimPlanResult = {
  /** 경로의 각 시점 YYYYMM (0 = 시작월) */
  labels: string[]
  paid: number[]
  value: number[]
  /** 시간가중 지수(시작 = 1) — 섞어보기 curve와 같은 값 */
  index: number[]
  months: number
  stats: SimPlanStats
}

const DEFAULT_COST = 0.001

type Prepared = {
  ids: string[]
  target: number[]
  timeline: string[]
  /** growth[k][i] = 자산 k의 timeline[i−1] → timeline[i] 월 수익률(dragPct/12 뺀 값). i = 0은 0 */
  growth: number[][]
  /** timeline[i]가 그해 마지막 달인지(다음 달이 다른 해) */
  yearEnd: boolean[]
}

function prepare(weights: Weights, assets: MixAsset[]): Prepared | null {
  const w = normalize(weights)
  const ids = Object.keys(w)
  if (!ids.length) return null
  const found = ids.map((id) => assets.find((a) => a.id === id))
  if (found.some((a) => !a)) return null
  const prices = (found as MixAsset[]).map((a) => new Map(a.monthly))
  const timeline = [...prices[0].keys()].filter((ym) => prices.every((p) => p.has(ym))).sort()
  // 시작월마다 다시 도는 rollingStarts가 문자열 조회를 반복하지 않게 미리 숫자 배열로 (IRR 생략과 함께 10년 기간 구성당 ~200ms → ~10ms, 2026-10-22 vitest 실측)
  const growth = (found as MixAsset[]).map((a, k) => {
    const drag = a.dragPct / 100 / 12
    return timeline.map((ym, i) => (i === 0 ? 0 : prices[k].get(ym)! / prices[k].get(timeline[i - 1])! - 1 - drag))
  })
  const yearEnd = timeline.map((ym, i) => i === timeline.length - 1 || timeline[i + 1].slice(0, 4) !== ym.slice(0, 4))
  return { ids, target: ids.map((id) => w[id]), timeline, growth, yearEnd }
}

/** 구성에서 쓸 수 있는 월(모든 자산에 가격이 있는 달) — 시작·끝 선택지 */
export function commonMonths(weights: Weights, assets: MixAsset[] = MIX_ASSETS): string[] {
  return prepare(weights, assets)?.timeline ?? []
}

/** 금전가중 연수익률 — 월 현금흐름(음수=넣음, 마지막=평가금)의 IRR을 이분법으로 */
export function annualIrr(flows: number[]): number | null {
  if (flows.length < 2 || !flows.some((f) => f < 0) || !flows.some((f) => f > 0)) return null
  const npv = (m: number) => flows.reduce((s, f, t) => s + f / (1 + m) ** t, 0)
  let lo = -0.99
  let hi = 1
  if (npv(lo) * npv(hi) > 0) return null
  for (let k = 0; k < 200; k += 1) {
    const mid = (lo + hi) / 2
    if (npv(lo) * npv(mid) <= 0) hi = mid
    else lo = mid
  }
  return (1 + (lo + hi) / 2) ** 12 - 1
}

/** light = 분포용: 경로·IRR 없이 끝 배율만 필요할 때 (IRR 이분법이 대부분의 시간을 쓴다) */
function run(p: Prepared, s: number, n: number, input: SimPlanInput, light = false): SimPlanResult {
  const { target, timeline, growth, yearEnd } = p
  const rebalance = input.rebalance ?? 'year'
  const cost = input.rebalanceCost ?? DEFAULT_COST
  const lump = Math.max(0, input.lump ?? 0)
  const base = Math.max(0, input.monthly ?? 0)
  const raise = input.monthlyRaisePct ?? 0
  const labels = timeline.slice(s, s + n + 1)

  /** 한 달 자라게 하고, 되돌릴 달이면 목표 비중으로 되돌리며 비용을 뺀다(simulateMix와 같은 순서) */
  const grow = (x: number[], t: number): number[] => {
    const i = s + t
    const grown = x.map((v, k) => v * (1 + growth[k][i]))
    const sum = grown.reduce((a, v) => a + v, 0)
    const lastOfYear = t === n || yearEnd[i]
    if (!(sum > 0) || !(rebalance === 'month' || (rebalance === 'year' && lastOfYear))) return grown
    const turn = grown.reduce((a, v, k) => a + Math.abs(v / sum - target[k]), 0)
    return target.map((tk) => tk * sum * (1 - turn * cost))
  }

  let h = target.map((t) => t * lump)
  // 시간가중 지수 = 1을 한 번에 넣고 같은 규칙으로 따라간 값 — 넣는 돈·시점과 무관한 구성 자체의 성과(섞어보기 curve)
  let ix = [...target]
  const value: number[] = []
  const paid: number[] = []
  const index: number[] = []
  const flows: number[] = []
  let paidSum = 0

  for (let t = 0; t <= n; t += 1) {
    if (t > 0) {
      h = grow(h, t)
      if (!light) ix = grow(ix, t)
    }
    value.push(h.reduce((a, v) => a + v, 0))
    paid.push(paidSum + lump)
    index.push(ix.reduce((a, v) => a + v, 0))
    const c = t < n ? base * (1 + raise) ** Math.floor(t / 12) : 0
    flows.push(-(c + (t === 0 ? lump : 0)))
    if (c > 0) {
      if (rebalance === 'cashflow') h = allocateToUnderweight(h, target, c)
      else h = h.map((v, k) => v + target[k] * c)
      paidSum += c
    }
  }
  flows[n] += value[n]

  let peak = 1
  let mdd = 0
  for (const v of index) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1) }
  let trough: SimPlanStats['trough'] = null
  let under = 0
  let longest = 0
  for (let t = 1; t <= n; t += 1) {
    if (!(paid[t] > 0)) continue
    const pct = (value[t] / paid[t] - 1) * 100
    if (pct < 0 && (!trough || pct < trough.pct)) trough = { pct, ym: labels[t], step: t }
    under = value[t] < paid[t] ? under + 1 : 0
    longest = Math.max(longest, under)
  }
  let recoveryMonths: number | null = null
  if (trough) {
    for (let t = trough.step + 1; t <= n; t += 1) {
      if (value[t] >= paid[t]) { recoveryMonths = t - trough.step; break }
    }
  }
  const paidTotal = paid[n]
  return {
    labels, paid, value, index, months: n,
    stats: {
      endValue: value[n], paidTotal, ratio: paidTotal > 0 ? value[n] / paidTotal : 0,
      irr: light ? null : annualIrr(flows), cagr: n > 0 ? index[n] ** (12 / n) - 1 : 0, mdd, trough, recoveryMonths, longestUnderwaterMonths: longest,
    },
  }
}

/** 새 돈을 목표보다 모자란 자산에 모자란 만큼 비례해 넣는다. 모자란 자산이 없으면 목표 비중대로 */
function allocateToUnderweight(h: number[], target: number[], c: number): number[] {
  const total = h.reduce((a, v) => a + v, 0) + c
  const gap = target.map((t, k) => Math.max(0, t * total - h[k]))
  const g = gap.reduce((a, v) => a + v, 0)
  return g > 0 ? h.map((v, k) => v + (gap[k] / g) * c) : h.map((v, k) => v + target[k] * c)
}

function span(p: Prepared, startYm?: string, endYm?: string): { s: number; n: number } | null {
  const s = startYm ? p.timeline.indexOf(startYm) : 0
  const e = endYm ? p.timeline.indexOf(endYm) : p.timeline.length - 1
  if (s < 0 || e <= s) return null
  return { s, n: e - s }
}

/** 고른 구성·기간·넣는 방식 하나를 따라간 결과. 기간이 데이터 밖이거나 시작≥끝이면 null */
export function simulatePlan(input: SimPlanInput): SimPlanResult | null {
  const p = prepare(input.weights, input.assets ?? MIX_ASSETS)
  if (!p) return null
  const w = span(p, input.startYm, input.endYm)
  if (!w) return null
  return run(p, w.s, w.n, input)
}

export type RollingResult = {
  /** 같은 길이로 시작할 수 있었던 시작월 수 */
  count: number
  /** 시작월별 끝 평가금 / 넣은 돈, 오름차순 */
  ratios: number[]
  min: number
  p10: number
  median: number
  max: number
  /** 고른 기간의 끝 배율 */
  chosen: number
  /** 고른 기간보다 끝 배율이 낮았던 시작월 비율(%) — simulatePeriod.worsePct와 같은 정의 */
  worsePct: number
}

/**
 * 같은 길이·같은 넣는 방식을 데이터 안의 모든 시작월로 돌린 끝 배율 분포 — 고른 한 기간이 운이 좋았는지 보여 준다.
 * 일시금·적립이 모두 0이면 null.
 */
export function rollingStarts(input: SimPlanInput): RollingResult | null {
  const p = prepare(input.weights, input.assets ?? MIX_ASSETS)
  if (!p) return null
  const w = span(p, input.startYm, input.endYm)
  if (!w) return null
  const chosen = run(p, w.s, w.n, input).stats
  if (!(chosen.paidTotal > 0)) return null
  const all: number[] = []
  for (let st = 0; st + w.n < p.timeline.length; st += 1) all.push(run(p, st, w.n, input, true).stats.ratio)
  // 부동소수 오차로 같은 배율이 "더 낮음"으로 세지지 않게 상대 1e-12 여유
  const worse = all.filter((r) => r < chosen.ratio * (1 - 1e-12)).length
  const ratios = [...all].sort((a, b) => a - b)
  const q = (f: number) => ratios[Math.floor(ratios.length * f)]
  return {
    count: ratios.length, ratios, min: ratios[0], p10: q(0.1), median: q(0.5), max: ratios[ratios.length - 1],
    chosen: chosen.ratio, worsePct: (worse / ratios.length) * 100,
  }
}

export type RollingPaths = {
  /** 같은 길이로 시작할 수 있었던 시작월 수 */
  count: number
  months: number
  /** 시점 YYYYMM (고른 기간 기준 이름표 — 다른 시작 달의 경로는 같은 "시작 후 n개월"에 놓는다) */
  labels: string[]
  /** 시점별 넣은 돈 — 시작 달과 무관하게 같다 */
  paid: number[]
  /** paths[시작 달][시점] = 평가금 / 넣은 돈. 넣은 돈이 아직 0인 시점은 NaN */
  paths: number[][]
  /** 시점별 하위 10%·중앙·상위 10% 배율(넣은 돈이 0인 시점은 NaN) */
  p10: number[]
  median: number[]
  p90: number[]
  /** 고른 기간의 시점별 배율 */
  chosen: number[]
  /** 한 번이라도 원금(배율 1) 아래로 내려간 시작 달 수 */
  underwater: number
  /** underwater 여부 — paths와 같은 순서 */
  isUnderwater: boolean[]
}

/**
 * rollingStarts와 같은 입력으로, 시작 달마다 "시작 후 n개월" 경로 전체를 모은다 — 끝 값만이 아니라 중간에 얼마나 내려갔는지를 보여 준다.
 * 랜덤 가정이 아니라 데이터 안에 실제로 있었던 시작 달들이다. 시작 달 사이에 기간이 겹치므로 독립 표본이 아니다.
 */
export function rollingPaths(input: SimPlanInput): RollingPaths | null {
  const p = prepare(input.weights, input.assets ?? MIX_ASSETS)
  if (!p) return null
  const w = span(p, input.startYm, input.endYm)
  if (!w) return null
  const chosenRun = run(p, w.s, w.n, input, true)
  if (!(chosenRun.stats.paidTotal > 0)) return null
  const { paid } = chosenRun
  const ratioOf = (value: number[]) => value.map((v, t) => (paid[t] > 0 ? v / paid[t] : NaN))
  const paths: number[][] = []
  for (let st = 0; st + w.n < p.timeline.length; st += 1) paths.push(ratioOf(run(p, st, w.n, input, true).value))
  const band = (f: number) => paid.map((_, t) => {
    const col = paths.map((r) => r[t]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
    return col.length ? col[Math.min(col.length - 1, Math.floor(col.length * f))] : NaN
  })
  const isUnderwater = paths.map((r) => r.some((v, t) => t > 0 && v < 1))
  return {
    count: paths.length, months: w.n, labels: chosenRun.labels, paid, paths,
    p10: band(0.1), median: band(0.5), p90: band(0.9), chosen: ratioOf(chosenRun.value),
    underwater: isUnderwater.filter(Boolean).length, isUnderwater,
  }
}
