import { describe, expect, it } from 'vitest'
import { COMMENTARY, claimView, commentaryStale, type CommentaryClaim } from './commentaryCheck'

const base: CommentaryClaim = {
  id: 1, quote: 'q', rule: '규칙', short: 's', first: '1998-01-09', last: '2026-09-04',
  weeks: 1495, onWeeks: 154, independentEvents: 51, rateOnPct: 18.8, rateOffPct: 19.0, ratio: 0.99,
  controlledDiffPp: -1.4, pHolm: 1, laterReturn60dDiffPct: 3.5, verdict: 'not_confirmed', directionOnly: false,
}

describe('claimView', () => {
  it('확인되지 않은 항목은 "틀렸다"가 아니라 "확인되지 않았다"고 말한다', () => {
    const v = claimView(base)
    expect(v.headline).toBe('먼저 알려 주는 신호로는 확인되지 않았어요')
    expect(v.mainLine).toContain('18.8%')
    expect(v.mainLine).toContain('19.0%')
    expect(v.subLine).toBe('1998-01~2026-09 · 서로 겹치지 않는 사례 51건')
  })
  it('방향은 같지만 보정 뒤 구분되지 않으면 그렇게 말한다', () => {
    const v = claimView({ ...base, directionOnly: true, controlledDiffPp: 12.2, pHolm: 0.42 })
    expect(v.headline).toContain('우연과 구분되지 않았어요')
    expect(v.tone).toBe('caution')
    expect(v.detailLines.join('\n')).toContain('+12.2%p')
    expect(v.detailLines.join('\n')).toContain('42%')
  })
  it('사례가 적으면 결론을 내리지 않는다', () => {
    const v = claimView({ ...base, verdict: 'insufficient', independentEvents: 7 })
    expect(v.headline).toBe('판단하기엔 사례가 너무 적어요')
    expect(v.detailLines.at(-1)).toContain('10건 미만')
  })
})

describe('commentaryStale', () => {
  it('생성한 지 180일이 넘으면 낡음', () => {
    expect(commentaryStale('2026-10-27', new Date('2027-01-01'))).toBe(false)
    expect(commentaryStale('2026-10-27', new Date('2027-05-01'))).toBe(true)
  })
})

describe('commonBeliefs.json', () => {
  it('항목 8개, 생성일·스크립트·한계가 있다', () => {
    expect(COMMENTARY.claims).toHaveLength(8)
    expect(COMMENTARY.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(COMMENTARY.script).toContain('validate_common_beliefs')
    expect(COMMENTARY.caveats.length).toBeGreaterThan(0)
    for (const c of COMMENTARY.claims) {
      expect(c.rateOnPct).toBeGreaterThan(0)
      expect(c.first < c.last).toBe(true)
    }
  })
})
