/**
 * calculateScore() 단위 테스트
 * 점수 엔진이 데이터가 부족할 때 null을 반환하고,
 * 충분한 OHLCV 데이터가 주어지면 유효한 점수를 반환하는지 검증한다.
 */
import { describe, it, expect } from 'vitest'
import { calculateScore } from '../../../src/score/engine'
import type { StockOHLCV } from '../../../src/data/types'

/** 가격이 선형으로 상승하는 더미 OHLCV 데이터 생성 */
function makeDummyOHLCV(count: number, startPrice = 10000, step = 10): StockOHLCV[] {
  return Array.from({ length: count }, (_, i) => {
    const close = startPrice + i * step
    return {
      code: '005930',
      date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
      open: close - 50,
      high: close + 100,
      low: close - 100,
      close,
      volume: 500_000 + Math.floor(Math.random() * 100_000),
      amount: close * (500_000 + Math.floor(Math.random() * 100_000)),
    }
  })
}

describe('calculateScore', () => {
  it('데이터 수가 200개 미만이면 null을 반환한다', () => {
    const data = makeDummyOHLCV(150)
    expect(calculateScore(data)).toBeNull()
  })

  it('반환된 점수 객체를 반환한다', () => {
    const data = makeDummyOHLCV(250)
    const score = calculateScore(data)
    expect(score).not.toBeNull()
    expect(typeof score?.score).toBe('number')
  })

  it('반환된 score는 0~100 범위에 있다', () => {
    const data = makeDummyOHLCV(300)
    const score = calculateScore(data)
    expect(score).not.toBeNull()
    const total = score!.score
    expect(total).toBeGreaterThanOrEqual(0)
    expect(total).toBeLessThanOrEqual(100)
  })

  it('빈 배열이면 null을 반환한다', () => {
    expect(calculateScore([])).toBeNull()
  })

  it('marketEnv를 함께 전달해도 정상 동작한다', () => {
    const data = makeDummyOHLCV(300)
    const score = calculateScore(data, { vix: 20, fearGreed: 55 })
    expect(score).not.toBeNull()
    expect(typeof score?.score).toBe('number')
  })
})
