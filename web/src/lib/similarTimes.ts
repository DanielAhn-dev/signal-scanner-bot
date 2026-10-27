import data from '../data/similarTimes.json'

/** 지금과 비슷했던 때 — scripts/research/build_similar_times.py가 만든 JSON을 읽는다 (직접 고치지 않는다) */
export type SimilarSample = {
  /** 주 마지막 거래일 YYYYMMDD */
  d: string
  /** 심리 점수 0~100 */
  s: number
  /** 60일 고점 대비 % */
  dd: number
  /** 20일 변동성 연율 % */
  v: number
  /** 이후 5거래일 간격 누적 수익률 % (120거래일까지) */
  r: number[]
  /** 이후 60거래일 안 최저 수익률 % */
  m: number
}

export type SimilarData = {
  generated: string
  script: string
  period: string
  sampleCount: number
  stepDays: number
  std: { s: number; dd: number; v: number }
  baseline: {
    '20': Quant
    '60': Quant
    '120': Quant
    path: { median: number[]; p10: number[]; p90: number[] }
    down10Pct: number
  }
  samples: SimilarSample[]
}

type Quant = { median: number; p10: number; p90: number }

export const SIMILAR = data as unknown as SimilarData

/** 서버(/api/ui/similar-times)가 계산한 코스피 오늘 상태 */
export type NowState = { asOf: string; score: number; dd60: number; vol20: number }

export const NEIGHBORS = 40
/** 같은 때로 묶는 간격(일). 이보다 가까운 주는 한 사례로 센다 */
export const INDEPENDENT_GAP_DAYS = 28
/** 표에 보여 주는 기간(거래일) → 경로 인덱스 */
export const HORIZONS = [
  { days: 20, label: '1개월 뒤', key: '20' as const, idx: 3 },
  { days: 60, label: '3개월 뒤', key: '60' as const, idx: 11 },
  { days: 120, label: '6개월 뒤', key: '120' as const, idx: 23 },
]

export function quantile(values: number[], p: number): number {
  if (!values.length) return NaN
  const a = [...values].sort((x, y) => x - y)
  const pos = (a.length - 1) * (p / 100)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return a[lo] + (a[hi] - a[lo]) * (pos - lo)
}

function dayNumber(d: string): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))) / 86_400_000
}

export type SimilarResult = {
  /** 가장 가까운 주 수 */
  count: number
  /** 서로 겹치지 않는 사례 수 */
  independent: number
  /** 겹치지 않는 사례 중 가까운 순 (차트·목록용) */
  cases: Array<{ date: string; path: number[]; distance: number }>
  /** 가까운 주 전체의 기간별 분포 */
  horizons: Array<{ days: number; label: string; median: number; p10: number; p90: number; base: Quant }>
  /** 가까운 주 전체의 경로 중앙값 */
  medianPath: number[]
  /** 이후 3개월 안에 10% 넘게 더 빠진 비율(%) */
  down10Pct: number
}

export function findSimilar(now: Pick<NowState, 'score' | 'dd60' | 'vol20'>, d: SimilarData = SIMILAR, k: number = NEIGHBORS): SimilarResult | null {
  if (!d.samples.length) return null
  const scored = d.samples
    .map((x) => ({
      x,
      dist: Math.sqrt(
        ((x.s - now.score) / d.std.s) ** 2 + ((x.dd - now.dd60) / d.std.dd) ** 2 + ((x.v - now.vol20) / d.std.v) ** 2,
      ),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, k)
  const accepted: typeof scored = []
  for (const c of scored) {
    if (accepted.every((a) => Math.abs(dayNumber(a.x.d) - dayNumber(c.x.d)) >= INDEPENDENT_GAP_DAYS)) accepted.push(c)
  }
  const steps = d.samples[0].r.length
  const medianPath = Array.from({ length: steps }, (_, i) => quantile(scored.map((c) => c.x.r[i]), 50))
  return {
    count: scored.length,
    independent: accepted.length,
    cases: accepted.map((a) => ({ date: a.x.d, path: a.x.r, distance: a.dist })),
    horizons: HORIZONS.map((h) => {
      const col = scored.map((c) => c.x.r[h.idx])
      return { days: h.days, label: h.label, median: quantile(col, 50), p10: quantile(col, 10), p90: quantile(col, 90), base: d.baseline[h.key] }
    }),
    medianPath,
    down10Pct: (scored.filter((c) => c.x.m <= -10).length / scored.length) * 100,
  }
}

function percentileOf(value: number, arr: number[]): number {
  if (!arr.length) return NaN
  return (arr.filter((v) => v <= value).length / arr.length) * 100
}

export type StateView = { headline: string; volText: string; volPercentile: number }

/** 지금 상태를 말로. '과열'·'팔아라' 같은 표현은 쓰지 않는다(심리 극단은 꺾임 신호가 아니었다, H82) */
export function stateView(now: Pick<NowState, 'score' | 'dd60' | 'vol20'>, d: SimilarData = SIMILAR): StateView {
  const volPercentile = percentileOf(now.vol20, d.samples.map((x) => x.v))
  const volText =
    volPercentile >= 90 ? '평소보다 매우 큼' : volPercentile >= 70 ? '평소보다 큼' : volPercentile <= 30 ? '평소보다 작음' : '평소와 비슷'
  const headline =
    now.score >= 70 ? '가격이 높은 자리에서 조용히 오르는 구간' : now.score <= 30 ? '가격이 약해지고 흔들리는 구간' : '오르내림이 섞인 중간 구간'
  return { headline, volText, volPercentile }
}

/** 자료를 만든 지 180일이 넘었는지 */
export function similarTimesStale(generated: string = SIMILAR.generated, today: Date = new Date()): boolean {
  const t = Date.parse(generated)
  return Number.isFinite(t) && (today.getTime() - t) / 86_400_000 > 180
}

export const signedPct = (v: number, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`

/** YYYYMMDD → 'YYYY.M' */
export const ymLabel = (d: string) => `${d.slice(0, 4)}.${Number(d.slice(4, 6))}`
