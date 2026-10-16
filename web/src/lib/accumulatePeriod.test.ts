import { describe, expect, it } from 'vitest'
import { simulatePeriod } from './accumulate'

// 100 → 50 → 100 → 200: 반토막 뒤 회복하는 가격
const series: Array<[string, number]> = [['202001', 100], ['202002', 50], ['202003', 100], ['202004', 200], ['202005', 200]]

describe('기간 골라 보기', () => {
  it('매달 초에 넣고 그 달 가격으로 평가한다(마지막 달은 평가만)', () => {
    const r = simulatePeriod({ startYm: '202001', endYm: '202004', monthly: 100, series })!
    expect(r.months).toBe(3)
    expect(r.paid).toEqual([0, 100, 200, 300])
    // 단위: 1/100 + 1/50 + 1/100 = 0.04 → 202004 가격 200 × 0.04 × 100 = 800
    expect(r.value[3]).toBeCloseTo(800)
    expect(r.labels).toEqual(['202001', '202002', '202003', '202004'])
  })

  it('원금 대비 가장 깊었던 지점과 회복까지 개월을 찾는다', () => {
    const r = simulatePeriod({ startYm: '202001', endYm: '202004', monthly: 100, series })!
    expect(r.trough?.ym).toBe('202002')
    expect(r.trough?.pct).toBeCloseTo(-50)
    expect(r.recoveryMonths).toBe(1)
  })

  it('같은 길이로 시작할 수 있었던 모든 시작점 중 이보다 나빴던 비율', () => {
    const r = simulatePeriod({ startYm: '202001', endYm: '202003', monthly: 100, series })!
    // 2개월 길이 시작점: 202001·202002·202003 → 3가지
    expect(r.peers).toBe(3)
    expect(r.worsePct).toBeGreaterThanOrEqual(0)
    expect(r.worsePct).toBeLessThanOrEqual(100)
  })

  it('끝이 시작보다 앞서거나 데이터 밖이면 계산하지 않는다', () => {
    expect(simulatePeriod({ startYm: '202003', endYm: '202001', monthly: 100, series })).toBeNull()
    expect(simulatePeriod({ startYm: '201901', endYm: '202003', monthly: 100, series })).toBeNull()
  })

  it('한 번도 원금 아래로 안 내려가면 가장 깊은 지점은 없다', () => {
    const r = simulatePeriod({ startYm: '202003', endYm: '202005', monthly: 100, series })!
    expect(r.trough).toBeNull()
    expect(r.recoveryMonths).toBeNull()
  })
})
