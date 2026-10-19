/**
 * 내 선택 한꺼번에 보기 — 상품(비중)·넣는 방식·기간을 따로 떼어 좋은 쪽만 보지 않도록, 한 번에 정한 조합을
 * 과거의 모든 시작 달에 그대로 적용해 결과의 범위를 낸다. 시작 시점(운)은 고르는 조건이 아니라 분포로 보여준다.
 * 가격은 섞어보기와 같은 자료(data/mixData.ts, 스크립트 생성)와 같은 계산(simulateMix, 연 1회 리밸런싱)을 쓴다.
 * 분할 중 아직 안 넣은 돈은 수익 0%로 둔다(data/splitPlans.ts와 같은 가정).
 */
import { MIX_ASSETS, type MixAsset } from '../data/mixData'
import { simulateMix, type Weights } from './mix'

export type EntryMethod = 'lump' | 'split6' | 'split12'

export const ENTRY_METHODS: Array<{ id: EntryMethod; label: string; months: number }> = [
  { id: 'lump', label: '한 번에', months: 1 },
  { id: 'split6', label: '6개월 나눠', months: 6 },
  { id: 'split12', label: '12개월 나눠', months: 12 },
]

export type StartOutcome = {
  /** 시작 달 YYYYMM */
  start: string
  /** 기간 끝 평가 ÷ 넣은 돈 */
  end: number
  /** 기간 중 가장 낮았던 (평가 + 아직 안 넣은 돈) ÷ 넣을 돈 전체 */
  low: number
  /** 첫 12개월 중 가장 낮았던 값 (같은 기준) */
  firstYearLow: number
}

export type WholeChoiceSummary = {
  from: string
  to: string
  /** 시작 달 수 — 겹치는 창이라 독립 표본이 아니다 */
  starts: number
  /** 겹치지 않는 창 수(대략의 독립 표본) */
  independent: number
  end: { best: number; median: number; p10: number; worst: number }
  /** 끝에 원금 아래였던 시작 달 비율(0~1) */
  belowPrincipalShare: number
  low: { median: number; p10: number; worst: number }
  /** 첫 1년 안에 −10% 이상 손실을 본 시작 달 비율(0~1) */
  firstYearHit10Share: number
  bestStart: string
  worstStart: string
}

function prevYm(ym: string): string {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(4, 6))
  return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, '0')}`
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return Number.NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** 시작 달마다 결과. 이력이 기간보다 짧으면 빈 배열 */
export function wholeChoiceOutcomes(weights: Weights, method: EntryMethod, years: number, assets: MixAsset[] = MIX_ASSETS): StartOutcome[] {
  const sim = simulateMix(weights, 'year', assets)
  if (!sim) return []
  const { curve, yms } = sim
  const horizon = Math.round(years * 12)
  const parts = ENTRY_METHODS.find((m) => m.id === method)?.months ?? 1
  if (horizon < parts || curve.length <= horizon) return []
  const out: StartOutcome[] = []
  for (let s = 0; s + horizon < curve.length; s++) {
    let units = 0
    let cash = 1
    let low = 1
    let firstYearLow = 1
    for (let t = 0; t <= horizon; t++) {
      if (t < parts) {
        units += 1 / parts / curve[s + t]
        cash -= 1 / parts
      }
      const total = units * curve[s + t] + Math.max(0, cash)
      if (total < low) low = total
      if (t <= 12 && total < firstYearLow) firstYearLow = total
    }
    // curve[s]는 yms[s] 달 말의 값이고, curve[0]은 첫 수익률 달의 전달 말이다(yms[0]은 빈 칸)
    out.push({ start: s === 0 ? prevYm(yms[1]) : yms[s], end: units * curve[s + horizon] + Math.max(0, cash), low, firstYearLow })
  }
  return out
}

export function summarizeWholeChoice(rows: StartOutcome[], years: number): WholeChoiceSummary | null {
  if (!rows.length) return null
  const ends = rows.map((r) => r.end).sort((a, b) => a - b)
  const lows = rows.map((r) => r.low).sort((a, b) => a - b)
  let best = rows[0]
  let worst = rows[0]
  for (const r of rows) {
    if (r.end > best.end) best = r
    if (r.end < worst.end) worst = r
  }
  return {
    from: rows[0].start,
    to: rows[rows.length - 1].start,
    starts: rows.length,
    independent: Math.max(1, Math.floor(rows.length / Math.round(years * 12))),
    end: { best: ends[ends.length - 1], median: quantile(ends, 0.5), p10: quantile(ends, 0.1), worst: ends[0] },
    belowPrincipalShare: rows.filter((r) => r.end < 1).length / rows.length,
    low: { median: quantile(lows, 0.5), p10: quantile(lows, 0.1), worst: lows[0] },
    firstYearHit10Share: rows.filter((r) => r.firstYearLow <= 0.9).length / rows.length,
    bestStart: best.start,
    worstStart: worst.start,
  }
}

/**
 * 고른 방식과 다른 방식을 같은 시작 달끼리 비교 — 어느 쪽을 골라도 후회할 수 있는 몫을 보여준다.
 * otherBetterShare: 다른 방식이 끝에 더 나았던 시작 달 비율, otherLowerPainShare: 다른 방식이 도중 최저가 덜 깊었던 비율.
 */
export function compareMethods(a: StartOutcome[], b: StartOutcome[]): { otherBetterShare: number; otherLowerPainShare: number; n: number } | null {
  const byStart = new Map(b.map((r) => [r.start, r]))
  let n = 0
  let better = 0
  let lessPain = 0
  for (const r of a) {
    const o = byStart.get(r.start)
    if (!o) continue
    n++
    if (o.end > r.end) better++
    if (o.low > r.low) lessPain++
  }
  return n ? { otherBetterShare: better / n, otherLowerPainShare: lessPain / n, n } : null
}
