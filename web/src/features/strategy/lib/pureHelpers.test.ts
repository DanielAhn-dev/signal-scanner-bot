import { describe, expect, it } from 'vitest'
import { formatMarketRegimeLabel, formatTriggerLabel } from './labels'
import { buildLinePath, calculateMovingAverage, formatKrwShort } from './chartMath'
import { getPreRallyBadge } from './preRally'

describe('labels', () => {
  it('알려진 트리거는 한글로, 모르는 값은 하이픈을 공백으로', () => {
    expect(formatTriggerLabel('Stop-Loss')).toBe('손절 매도')
    expect(formatTriggerLabel('some-new-kind')).toBe('some new kind')
    expect(formatTriggerLabel('')).toBe('-')
  })
  it('시장 국면 라벨: 모르는 값은 원문 유지', () => {
    expect(formatMarketRegimeLabel('RISK_OFF')).toBe('리스크 오프')
    expect(formatMarketRegimeLabel('weird')).toBe('weird')
    expect(formatMarketRegimeLabel('')).toBe('-')
  })
})

describe('chartMath', () => {
  it('금액 축약 표기', () => {
    expect(formatKrwShort(150_000_000)).toBe('1.5억')
    expect(formatKrwShort(-30_000)).toBe('-3만')
    expect(formatKrwShort(5_000)).toBe('5,000원')
  })
  it('경로와 이동평균', () => {
    expect(buildLinePath([])).toBe('')
    expect(buildLinePath([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('M 1 2 L 3 4')
    expect(calculateMovingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7])
  })
})

describe('getPreRallyBadge', () => {
  it('추천·주의·관찰 경계', () => {
    expect(getPreRallyBadge({ lift: 5, win: 45, mdd: -5 }).label).toBe('추천')
    expect(getPreRallyBadge({ lift: 6, win: 44, mdd: -16 }).label).toBe('주의')
    expect(getPreRallyBadge({ lift: -1, win: 60, mdd: -3 }).label).toBe('주의')
    expect(getPreRallyBadge({ lift: 2, win: 50, mdd: -5 }).label).toBe('관찰')
  })
})
