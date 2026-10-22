import { describe, expect, it } from 'vitest'
import { readSimPrefill, simLinkState, weightsFromPlan } from './prefill'

describe('시뮬레이터로 값 넘기기', () => {
  it('내 계획 구성(0~1)을 %로', () => {
    expect(weightsFromPlan([{ index: 'kospi200', weight: 0.5 }, { index: 'sp500', weight: 0.5 }])).toEqual({ kospi200: 50, sp500: 50 })
    expect(weightsFromPlan([{ index: 'kospi200', weight: 1 / 3 }, { index: 'sp500', weight: 0 }])).toEqual({ kospi200: 33.3 })
  })

  it('넘긴 그대로 읽는다', () => {
    const p = { slots: [{ label: '내 계획 구성', weights: { kospi200: 100 } }], monthly: 500_000, lump: 1_000_000, raisePct: 0.03, years: 10 }
    expect(readSimPrefill(simLinkState(p))).toEqual(p)
  })

  it('이상한 값은 버리고 나머지만 — 모르는 자산·음수·범위 밖', () => {
    const known = new Set(['kospi200', 'sp500'])
    const r = readSimPrefill({ simPrefill: {
      slots: [{ label: 'x', weights: { kospi200: 50, bogus: 50 } }, { weights: { bogus: 1 } }, { weights: { sp500: -1 } }],
      monthly: -5, lump: Number.NaN, raisePct: 2, years: 2.5,
    } }, known)
    expect(r).toEqual({ slots: [{ label: 'x', weights: { kospi200: 50 } }] })
  })

  it('구성은 3개까지', () => {
    const slot = { label: 'a', weights: { kospi200: 1 } }
    expect(readSimPrefill(simLinkState({ slots: [slot, slot, slot, slot] }))!.slots).toHaveLength(3)
  })

  it('없거나 비었으면 null', () => {
    expect(readSimPrefill(null)).toBeNull()
    expect(readSimPrefill({ seedBuilderCapital: 1 })).toBeNull()
    expect(readSimPrefill({ simPrefill: {} })).toBeNull()
  })
})
