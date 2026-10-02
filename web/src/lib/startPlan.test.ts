import { describe, expect, it } from 'vitest'
import { personalSetup, profileComplete, PROFILE_QUESTIONS } from './startPlan'

describe('personalSetup', () => {
  const base = { reaction: 'hold', horizon: 'long', emergency: 'enough', checking: 'weekly', experience: 'some' }
  it('1년 안에 쓸 돈이면 점수와 상관없이 안전형', () => {
    expect(personalSetup({ ...base, horizon: 'short', reaction: 'buy' }, 500_000).level).toBe('safe')
  })
  it('불안·초보·비상금 없음이면 안전형, 여유 있는 장기 투자자는 균형형', () => {
    expect(personalSetup({ reaction: 'sell', horizon: 'mid', emergency: 'none', checking: 'often', experience: 'none' }, 100_000).level).toBe('safe')
    expect(personalSetup({ ...base, reaction: 'buy', experience: 'lots' }, 500_000).level).toBe('balanced')
  })
  it('모두 지수 보유 모드로 시작하고 요약을 돌려준다', () => {
    const s = personalSetup(base, 500_000)
    expect(s.strategyMode).toBe('index_hold')
    expect(s.summary.length).toBeGreaterThan(2)
  })
  it('모든 질문에 답해야 완료로 본다', () => {
    expect(profileComplete(base)).toBe(true)
    expect(profileComplete({ ...base, horizon: '' })).toBe(false)
    expect(PROFILE_QUESTIONS).toHaveLength(5)
  })
})
