import { describe, expect, it } from 'vitest'
import { SIMILAR, findSimilar, quantile, similarTimesStale, stateView, type SimilarData, type SimilarSample } from './similarTimes'

const mk = (d: string, s: number, dd: number, v: number, end: number): SimilarSample => ({
  d, s, dd, v, r: Array.from({ length: 24 }, (_, i) => ((i + 1) / 24) * end), m: end < 0 ? end : -1,
})
const tiny: SimilarData = {
  generated: '2026-10-27', script: 'x', period: 'p', sampleCount: 4, stepDays: 5,
  std: { s: 20, dd: 6, v: 10 },
  baseline: { '20': { median: 1, p10: -5, p90: 7 }, '60': { median: 2, p10: -9, p90: 12 }, '120': { median: 4, p10: -12, p90: 20 }, path: { median: [], p10: [], p90: [] }, down10Pct: 20 },
  samples: [
    mk('20200306', 20, -18, 40, -20),     // 가장 비슷
    mk('20200313', 21, -19, 41, -10),     // 바로 다음 주 — 같은 사례로 센다
    mk('20081010', 22, -20, 45, -30),
    mk('20170901', 80, -1, 8, 10),        // 전혀 다른 상태
  ],
}

describe('quantile', () => {
  it('선형 보간 분위수', () => {
    expect(quantile([1, 2, 3, 4, 5], 50)).toBe(3)
    expect(quantile([0, 10], 25)).toBe(2.5)
    expect(Number.isNaN(quantile([], 50))).toBe(true)
  })
})

describe('findSimilar', () => {
  it('가까운 주를 고르고, 이어진 주는 한 사례로 센다', () => {
    const r = findSimilar({ score: 20, dd60: -18, vol20: 40 }, tiny, 3)!
    expect(r.count).toBe(3)
    expect(r.independent).toBe(2)               // 2020-03 두 주는 하나, 2008-10은 따로
    expect(r.cases[0].date).toBe('20200306')
    expect(r.horizons.map((h) => h.label)).toEqual(['1개월 뒤', '3개월 뒤', '6개월 뒤'])
    expect(r.horizons[2].median).toBeCloseTo(-20, 5)   // 6개월 뒤 = 경로 끝값 (−20, −10, −30의 중앙값)
    expect(r.down10Pct).toBe(100)
  })
  it('자료가 없으면 null', () => {
    expect(findSimilar({ score: 50, dd60: 0, vol20: 15 }, { ...tiny, samples: [] })).toBeNull()
  })
})

describe('stateView', () => {
  it('상태를 말로 하되 과열·매매 지시 표현은 쓰지 않는다', () => {
    const texts = [
      stateView({ score: 85, dd60: -1, vol20: 9 }, tiny),
      stateView({ score: 10, dd60: -20, vol20: 45 }, tiny),
      stateView({ score: 50, dd60: -5, vol20: 18 }, tiny),
    ].map((v) => `${v.headline} ${v.volText}`).join(' ')
    expect(texts).not.toMatch(/과열|팔|사세요|파세요|매수|매도/)
    expect(stateView({ score: 85, dd60: -1, vol20: 9 }, tiny).headline).toContain('조용히 오르는')
    expect(stateView({ score: 10, dd60: -20, vol20: 45 }, tiny).headline).toContain('흔들리는')
  })
})

describe('similarTimes.json', () => {
  it('표본·기준선·생성일이 있고 경로가 24개 점이다', () => {
    expect(SIMILAR.samples.length).toBe(SIMILAR.sampleCount)
    expect(SIMILAR.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(SIMILAR.samples[0].r).toHaveLength(24)
    expect(SIMILAR.baseline.path.median).toHaveLength(24)
    expect(SIMILAR.std.s).toBeGreaterThan(0)
  })
  it('180일이 지나면 낡음', () => {
    expect(similarTimesStale('2026-10-27', new Date('2027-01-01'))).toBe(false)
    expect(similarTimesStale('2026-10-27', new Date('2027-05-01'))).toBe(true)
  })
})
