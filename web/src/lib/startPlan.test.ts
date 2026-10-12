import { describe, expect, it } from 'vitest'
import { personalSetup, profileComplete, PROFILE_QUESTIONS } from './startPlan'

describe('personalSetup', () => {
  const base = { tolerance: '30', horizon: 'long', emergency: 'enough' }
  const legacy = { reaction: 'hold', horizon: 'long', emergency: 'enough', checking: 'weekly', experience: 'some' }
  it('1년 안에 쓸 돈이면 하락폭과 상관없이 안전형', () => {
    expect(personalSetup({ ...base, horizon: 'short', tolerance: '50' }, 500_000).level).toBe('safe')
  })
  it('비상금 없음·하락폭 10%면 안전형, 여유 있는 장기 투자자는 균형형', () => {
    expect(personalSetup({ ...base, emergency: 'none' }, 100_000).level).toBe('safe')
    expect(personalSetup({ ...base, tolerance: '10' }, 100_000).level).toBe('safe')
    expect(personalSetup(base, 500_000).level).toBe('balanced')
  })
  it('예전 다섯 질문 답은 예전 점수 기준을 그대로 쓴다', () => {
    expect(personalSetup({ reaction: 'sell', horizon: 'mid', emergency: 'none', checking: 'often', experience: 'none' }, 100_000).level).toBe('safe')
    expect(personalSetup({ ...legacy, reaction: 'buy', experience: 'lots' }, 500_000).level).toBe('balanced')
  })
  it('버틸 하락폭을 답하면 주식 비중 안내가 요약에 들어간다', () => {
    expect(personalSetup(base, 500_000).summary.some((line) => line.includes('버틸 하락 −30%'))).toBe(true)
  })
  it('모두 지수 보유 모드로 시작하고 요약을 돌려준다', () => {
    const s = personalSetup(base, 500_000)
    expect(s.strategyMode).toBe('index_hold')
    expect(s.summary.length).toBeGreaterThan(2)
  })
  it('모든 질문에 답해야 완료로 본다', () => {
    expect(profileComplete(base)).toBe(true)
    expect(profileComplete({ ...base, horizon: '' })).toBe(false)
    expect(profileComplete({ ...base, tolerance: '' })).toBe(false)
    expect(PROFILE_QUESTIONS.map((q) => q.key)).toEqual(['tolerance', 'horizon', 'emergency'])
  })
})
