import { FUTURE_EVENTS, FUTURE_MATERIAL, type FutureEvent } from '../data/futureMaterial'
import type { SimPath, SimResult } from './accumulate'
import type { MixIndex } from './planMix'

/**
 * 모아가기 3번 '앞으로 10년 경우의 수' — 예측이 아니라 과거 조각을 섞은 경우의 수.
 *
 * 블록 부트스트랩: 재료(1999-04~, 원화·분배금 반영 월 수익률)에서 실제 1년(12개월) 덩어리를 무작위로 골라 이어 붙인다.
 * 같은 달의 세 지수를 함께 쓰므로 위기 때 같이 빠지는 관계가 남는다. 덩어리 사이는 서로 독립이라고 가정한다(한계).
 * 매달 초 넣고, 매달 내 구성 비중대로 다시 맞춘다(lib/planMix.ts mixHistory와 같은 방식). 세금·환전비는 넣지 않는다.
 *
 * 순위·최적 구성은 내지 않는다(docs/plan-screen-map-2026-10-19.md 원칙 4). 같은 씨앗을 쓰므로 구성끼리는 같은 경우들을 겪는다.
 */

export const FUTURE_BLOCK_MONTHS = 12
export const FUTURE_DEFAULT_PATHS = 2000
export const FUTURE_DEFAULT_SEED = 20261019

export type FutureWeights = Array<{ index: MixIndex; weight: number }>

export type FutureInput = {
  mix: FutureWeights
  monthly: number
  lump?: number
  years?: number
  paths?: number
  seed?: number
  /** 끼워 넣을 사건과 몇 년 뒤에 시작할지 */
  event?: { key: string; atYear: number } | null
  /** '경우 하나' 선으로 보여 줄 경로 번호(0부터). 없으면 끝 결과가 보통(중앙값)에 가장 가까운 경로 */
  caseIndex?: number
  /** 테스트용 재료·사건 */
  returns?: Record<MixIndex, number[]>
  events?: FutureEvent[]
}

export type FutureResult = SimResult & {
  /** 끝 평가금 / 넣은 돈 — 보통(중앙값)·운 나쁨(하위 10%)·운 좋음(상위 10%) */
  typical: number
  low: number
  high: number
  /** 끝에 넣은 돈보다 적은 경우의 비율(%) */
  belowPrincipalPct: number
  event: FutureEvent | null
  /** 사건이 기간 안에 다 들어가지 못해 잘린 개월 수 */
  eventCutMonths: number
  /** '경우 하나'로 그린 경로 번호 */
  caseIndex: number
}

/** 같은 씨앗이면 같은 수열 — 화면이 다시 그려져도 경우들이 바뀌지 않는다 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** 구성 비중을 합 1로 맞춘 [지수, 비중] (0 이하 제외) */
function normalized(mix: FutureWeights): Array<[MixIndex, number]> {
  const pos = mix.filter((e) => e.weight > 0)
  const sum = pos.reduce((s, e) => s + e.weight, 0)
  return sum > 0 ? pos.map((e) => [e.index, e.weight / sum]) : [['kospi200', 1]]
}

/**
 * 한 경로의 달별 재료 위치 — 음수 -(k+1)이면 사건의 k번째 달.
 * 비중과 무관하게 씨앗만으로 정해지므로, 구성을 바꿔도 같은 경우들을 비교한다.
 */
function pathMonths(rand: () => number, n: number, materialLen: number, eventLen: number, eventAt: number): number[] {
  const out: number[] = []
  const lastStart = materialLen - FUTURE_BLOCK_MONTHS
  const fillTo = (until: number) => {
    while (out.length < until) {
      const s = Math.floor(rand() * (lastStart + 1))
      for (let k = 0; k < FUTURE_BLOCK_MONTHS && out.length < until; k += 1) out.push(s + k)
    }
  }
  if (eventLen > 0) {
    fillTo(Math.min(eventAt, n))
    for (let k = 0; k < eventLen && out.length < n; k += 1) out.push(-(k + 1))
  }
  fillTo(n)
  return out
}

export function simulateFuture(input: FutureInput): FutureResult {
  const years = Math.max(1, Math.round(input.years ?? 10))
  const n = years * 12
  const count = Math.max(1, Math.round(input.paths ?? FUTURE_DEFAULT_PATHS))
  const monthly = Math.max(0, input.monthly)
  const lump = Math.max(0, input.lump ?? 0)
  const returns = input.returns ?? FUTURE_MATERIAL.returns
  const events = input.events ?? FUTURE_EVENTS
  const weights = normalized(input.mix)
  const materialLen = returns.kospi200.length
  const event = input.event ? events.find((e) => e.key === input.event!.key) ?? null : null
  const eventAt = event ? Math.max(0, Math.round(input.event!.atYear * 12)) : 0
  const eventLen = event ? event.returns.kospi200.length : 0
  const eventCutMonths = event ? Math.max(0, eventAt + eventLen - n) : 0

  // 달마다 구성 수익률(매달 비중 맞춤 = 가중 평균)을 미리 계산
  const mixReturn = (src: Record<MixIndex, number[]>, i: number) => weights.reduce((s, [idx, w]) => s + w * src[idx][i], 0)
  const materialMix = Array.from({ length: materialLen }, (_, i) => mixReturn(returns, i))
  const eventMix = event ? Array.from({ length: eventLen }, (_, i) => mixReturn(event.returns, i)) : []

  const rand = mulberry32(input.seed ?? FUTURE_DEFAULT_SEED)
  const byStep: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(count))
  const finals: number[] = new Array<number>(count)
  const paid = Array.from({ length: n + 1 }, (_, i) => monthly * i + lump)

  for (let p = 0; p < count; p += 1) {
    const ms = pathMonths(rand, n, materialLen, eventLen, eventAt)
    let v = lump
    byStep[0][p] = v
    for (let i = 0; i < n; i += 1) {
      const m = ms[i]
      const r = m >= 0 ? materialMix[m] : eventMix[-m - 1]
      v = (v + monthly) * (1 + r)
      byStep[i + 1][p] = v
    }
    finals[p] = paid[n] > 0 ? v / paid[n] : 0
  }

  const sorted = byStep.map((row) => [...row].sort((a, b) => a - b))
  const finalSorted = [...finals].sort((a, b) => a - b)
  const mid = quantile(finalSorted, 0.5)
  let caseIndex = input.caseIndex != null ? Math.min(count - 1, Math.max(0, Math.round(input.caseIndex))) : 0
  if (input.caseIndex == null) {
    for (let p = 1; p < count; p += 1) if (Math.abs(finals[p] - mid) < Math.abs(finals[caseIndex] - mid)) caseIndex = p
  }
  const caseValues = byStep.map((row) => row[caseIndex])
  let troughPct = 0
  let troughStep = 0
  for (let i = 1; i <= n; i += 1) {
    if (paid[i] <= 0) continue
    const pct = (caseValues[i] / paid[i] - 1) * 100
    if (pct < troughPct) {
      troughPct = pct
      troughStep = i
    }
  }
  const deepest: SimPath = {
    start: `경우 ${caseIndex + 1}`,
    value: caseValues,
    troughPct,
    troughStep,
    finalRatio: finals[caseIndex],
  }
  return {
    starts: count,
    months: n,
    paid,
    worst: sorted.map((v) => v[0]),
    p10: sorted.map((v) => quantile(v, 0.1)),
    median: sorted.map((v) => quantile(v, 0.5)),
    p90: sorted.map((v) => quantile(v, 0.9)),
    finalRatios: finalSorted,
    deepest,
    typical: mid,
    low: quantile(finalSorted, 0.1),
    high: quantile(finalSorted, 0.9),
    belowPrincipalPct: (finalSorted.filter((r) => r < 1).length / count) * 100,
    event,
    eventCutMonths,
    caseIndex,
  }
}

/** 끝 평가금이 amount 이상인 경우의 비율(%) — 목표 트래커 '목표 이상인 경우' 한 줄 */
export function shareAtLeast(result: Pick<FutureResult, 'finalRatios' | 'paid' | 'months'>, amount: number): number {
  const paidEnd = result.paid[result.months]
  if (!(paidEnd > 0) || !result.finalRatios.length) return 0
  const hit = result.finalRatios.filter((r) => r * paidEnd >= amount).length
  return (hit / result.finalRatios.length) * 100
}
