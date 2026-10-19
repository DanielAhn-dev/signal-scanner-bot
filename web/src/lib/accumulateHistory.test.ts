import { describe, expect, it } from 'vitest'
import { KOSPI_HISTORY, maxSimYears, overseasHistoryFor, simulateDca } from './accumulate'

describe('시뮬레이션 이력 고르기', () => {
  it('나스닥100·S&P500을 그대로 따르는 상품만 그 지수 이력', () => {
    expect(overseasHistoryFor('TIGER 미국나스닥100')?.id).toBe('nasdaq100')
    expect(overseasHistoryFor('KODEX 미국S&P500')?.id).toBe('sp500')
    expect(overseasHistoryFor('ACE 미국 S&P 500')?.id).toBe('sp500')
  })
  it('레버리지·커버드콜·환헤지·채권혼합·일부 종목 상품은 null (코스피 이력 + 참고용 경고)', () => {
    for (const name of ['KODEX 미국S&P500테크놀로지', 'SOL 미국S&P500ESG', 'KODEX 미국S&P500헬스케어', 'TIGER 미국나스닥100레버리지(합성)', 'TIGER 미국나스닥100커버드콜(합성)', 'KODEX 미국S&P500(H)', 'RISE 미국S&P500미국채혼합50', 'TIGER 미국S&P500TOP10', 'KODEX 반도체', 'RISE 현대차고정피지컬AI']) {
      expect(overseasHistoryFor(name)).toBeNull()
    }
  })
  it('S&P500은 미국 ETF 원화 환산이라 빼는 몫(dragPct)이 있다', () => {
    expect(overseasHistoryFor('TIGER 미국S&P500')!.dragPct).toBeGreaterThan(0)
    expect(KOSPI_HISTORY.dragPct).toBe(0)
  })
})

describe('실제 한 사람 경로', () => {
  it('원금 대비 가장 깊게 빠졌던 시작점과 그 경로를 돌려준다', () => {
    // 20개월 횡보 → 6개월 반토막 → 회복. 시작점이 여러 개 생기게 길게
    const prices = [
      ...Array.from({ length: 20 }, () => 100),
      ...[90, 80, 70, 60, 55, 50],
      ...Array.from({ length: 30 }, (_, i) => 50 + i * 3),
    ]
    const months = prices.map((_, i) => `20${String(10 + Math.floor(i / 12))}${String((i % 12) + 1).padStart(2, '0')}`)
    const sim = simulateDca({ monthly: 100, years: 1, prices, months })!
    expect(sim.deepest).not.toBeNull()
    const d = sim.deepest!
    expect(d.value).toHaveLength(13)
    expect(d.troughPct).toBeLessThan(-30)
    // 경로의 바닥은 분위수 '최악' 선의 같은 시점 값 이상이다(최악은 그 시점 전체에서 가장 낮은 값)
    expect(d.value[d.troughStep]).toBeGreaterThanOrEqual(sim.worst[d.troughStep])
    expect(months).toContain(d.start)
  })
  it('넣는 돈이 없으면 경로 없음', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i)
    expect(simulateDca({ monthly: 0, years: 1, prices })!.deepest).toBeNull()
  })
})

describe('계산할 수 있는 가장 긴 기간', () => {
  it('시작점 12개 이상 남는 만큼, 15년 상한', () => {
    expect(maxSimYears(KOSPI_HISTORY.monthly.length)).toBe(15)
    expect(maxSimYears(overseasHistoryFor('TIGER 미국나스닥100')!.monthly.length)).toBeLessThan(15)
    expect(maxSimYears(12 + 1 + 60)).toBe(5)
    expect(maxSimYears(10)).toBe(0)
  })
})
