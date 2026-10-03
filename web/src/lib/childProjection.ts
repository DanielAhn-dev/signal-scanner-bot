/**
 * 자녀 계좌 장기 시뮬레이션 — 일시금·10년마다 추가 증여·월 적립을 미국 지수 1926~2023의 모든 시작월에 얹어 본 '오늘 가치' 범위.
 * 20~30년 시야는 한국 상장 지수 ETF 표본(약 24년)으로는 부족해 미국 장기 데이터를 쓴다. 세금·수수료는 반영하지 않는다.
 */
import { CHILD_LONGRUN_REAL_MONTHLY as R } from '../data/childLongRunData'

export const MIN_YEARS = 10
export const MAX_YEARS = 30
/** 적금 비교용 실질 연이율 — 명목 3% − 물가 2.5%, 세전 */
export const SAVINGS_REAL_ANNUAL = 0.005

export type ProjectionInput = {
  /** 지금 넣는 금액(원) */
  lump: number
  /** 10년마다(10년 뒤, 20년 뒤) 추가로 넣는 금액(원) — 증여 한도가 다시 열릴 때 */
  periodicLump: number
  monthly: number
  years: number
}

export type Projection = {
  invested: number
  p10: number
  median: number
  p90: number
  worst: number
  /** 같은 돈을 실질 연 0.5%짜리 적금에 넣었을 때 */
  savings: number
  windows: number
}

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

export function investedTotal(i: ProjectionInput): number {
  const months = Math.round(i.years * 12)
  return i.lump + i.periodicLump * Math.floor((months - 1) / 120) + i.monthly * months
}

/** 같은 입금 일정을 주어진 월 수익률 열에 적용 — 입금은 월초, 수익은 월말 */
function run(returns: ArrayLike<number>, start: number, i: ProjectionInput): number {
  const months = Math.round(i.years * 12)
  let v = i.lump
  for (let t = 0; t < months; t += 1) {
    if (t > 0 && t % 120 === 0) v += i.periodicLump
    v += i.monthly
    v *= 1 + returns[start + t]
  }
  return v
}

export function project(i: ProjectionInput): Projection | null {
  const years = Math.min(MAX_YEARS, Math.max(MIN_YEARS, Math.round(i.years)))
  const input = { ...i, years, lump: Math.max(0, i.lump), periodicLump: Math.max(0, i.periodicLump), monthly: Math.max(0, i.monthly) }
  const months = years * 12
  const starts = R.length - months + 1
  if (starts < 1) return null
  const values: number[] = []
  for (let s = 0; s < starts; s += 1) values.push(run(R, s, input))
  values.sort((a, b) => a - b)
  const flat = new Array<number>(months).fill((1 + SAVINGS_REAL_ANNUAL) ** (1 / 12) - 1)
  return {
    invested: investedTotal(input),
    p10: quantile(values, 0.1),
    median: quantile(values, 0.5),
    p90: quantile(values, 0.9),
    worst: values[0],
    savings: run(flat, 0, input),
    windows: starts,
  }
}
