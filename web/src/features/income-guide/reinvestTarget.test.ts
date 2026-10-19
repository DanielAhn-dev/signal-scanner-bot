import { describe, expect, it } from 'vitest'
import { reinvestLabel, reinvestTargets } from './reinvestTarget'

const plan = {
  buyTarget: { name: 'KODEX 200TR' },
  buyTargetsByAccount: [
    { accountLabel: '카카오 / 일반', target: { code: '294400', name: 'KIWOOM 200TR' } },
    { accountLabel: '미래 / ISA', target: { code: '360750', name: 'TIGER 미국S&P500' } },
  ],
}
const holdings = [
  { code: '498400', accountLabel: '카카오 / 일반' },
  { code: '458730', accountLabel: '미래 / ISA' },
]

describe('reinvestTargets', () => {
  it('분배금이 들어온 계좌의 살 곳을 따라간다', () => {
    expect(reinvestLabel(reinvestTargets(plan, ['498400'], holdings))).toBe('KIWOOM 200TR')
    expect(reinvestLabel(reinvestTargets(plan, ['498400', '458730'], holdings))).toBe('카카오 / 일반: KIWOOM 200TR · 미래 / ISA: TIGER 미국S&P500')
  })
  it('계좌별 자료가 없으면 전체 기준 살 곳', () => {
    expect(reinvestLabel(reinvestTargets({ buyTarget: { name: 'KODEX 200TR' } }, ['x'], []))).toBe('KODEX 200TR')
    expect(reinvestLabel(reinvestTargets(null, [], []))).toBeNull()
  })
})
