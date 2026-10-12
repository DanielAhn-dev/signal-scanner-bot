import { describe, expect, it } from 'vitest'
import { pct, signedPct, toEokFromWon } from './format'
import { isBuySignal, signalCls } from './signal'
import { autoTierLabel, confidenceMeta, matchMeta, pbrMeta } from './meta'

describe('format', () => {
  it('퍼센트 표기와 비정상 값', () => {
    expect(pct(12.345)).toBe('12.3%')
    expect(pct(12.345, 2)).toBe('12.35%')
    expect(pct(null)).toBe('0.0%') // Number(null) === 0 인 기존 동작을 그대로 고정
    expect(pct(undefined)).toBe('-')
    expect(signedPct(3)).toBe('+3.0%')
    expect(signedPct(-2.55, 1)).toBe('-2.5%')
    expect(signedPct(NaN)).toBe('-')
  })
  it('원을 억으로, 0 이하·비정상은 0', () => {
    expect(toEokFromWon(5_000_000_000)).toBe(50)
    expect(toEokFromWon(0)).toBe(0)
    expect(toEokFromWon(-1)).toBe(0)
    expect(toEokFromWon(null)).toBe(0)
  })
})

describe('signal', () => {
  it('매수 계열 판정', () => {
    expect(isBuySignal('STRONG_BUY')).toBe(true)
    expect(isBuySignal('accumulate')).toBe(true)
    expect(isBuySignal('매수 관심')).toBe(true)
    expect(isBuySignal('WATCH')).toBe(false)
    expect(isBuySignal(null)).toBe(false)
  })
  it('시그널 CSS 클래스', () => {
    expect(signalCls('buy')).toContain('--buy')
    expect(signalCls('SELL')).toContain('--sell')
    expect(signalCls('watch')).toContain('--watch')
    expect(signalCls('x')).toBe('bt-table-signal')
  })
})

describe('meta', () => {
  it('패턴 일치·표본·PBR 구간 경계', () => {
    expect(matchMeta(3).cls).toBe('bt-match--high')
    expect(matchMeta(2).cls).toBe('bt-match--mid')
    expect(matchMeta(1).cls).toBe('bt-match--low')
    expect(matchMeta(0).label).toBe('패턴 불일치')
    expect(confidenceMeta(20).label).toBe('표본 충분 (20)')
    expect(confidenceMeta(10).cls).toBe('bt-match--mid')
    expect(confidenceMeta(5).cls).toBe('bt-match--low')
    expect(confidenceMeta(4).label).toBe('표본 매우 적음 (4)')
    expect(pbrMeta(1).note).toContain('강한 저평가')
    expect(pbrMeta(1.5).note).toBe('저평가 구간')
    expect(pbrMeta(2.5).note).toBe('적정 수준')
    expect(pbrMeta(2.6).note).toBe('고평가')
  })
  it('자동 추천 단계 라벨', () => {
    expect(autoTierLabel('now')).toBe('즉시 매수 후보')
    expect(autoTierLabel('prepare')).toBe('반등 준비 후보')
    expect(autoTierLabel('watch')).toBe('관찰 후보')
  })
})
