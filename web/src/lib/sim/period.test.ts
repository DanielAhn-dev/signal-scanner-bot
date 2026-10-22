import { describe, expect, it } from 'vitest'
import { PERIOD_PRESETS, resolveCustom, resolvePreset, sharedMonths, shiftYm, spanText } from './period'

const range = (from: string, n: number) => Array.from({ length: n }, (_, i) => shiftYm(from, i))
const preset = (key: string) => PERIOD_PRESETS.find((p) => p.key === key)!

describe('기간 고르기', () => {
  it('shiftYm은 해를 넘긴다', () => {
    expect(shiftYm('202601', -1)).toBe('202512')
    expect(shiftYm('202512', 1)).toBe('202601')
    expect(shiftYm('202609', -120)).toBe('201609')
  })

  it('여러 구성이 함께 쓸 수 있는 달만 남긴다', () => {
    expect(sharedMonths([range('200001', 24), range('200101', 24)])).toEqual(range('200101', 12))
    expect(sharedMonths([])).toEqual([])
  })

  it('최근 n년: 끝은 마지막 달, 시작은 n×12개월 전', () => {
    const months = range('200001', 27 * 12)
    const r = resolvePreset(preset('r10'), months)!
    expect(r.end).toBe(months.at(-1))
    expect(r.start).toBe(shiftYm(months.at(-1)!, -120))
    expect(r.clamped).toBe(false)
  })

  it('이력보다 이른 시작은 첫 달로 당기고 알린다', () => {
    const months = range('201010', 192)
    const r = resolvePreset(preset('gfc'), months)!
    expect(r.start).toBe('201010')
    expect(r.clamped).toBe(true)
    expect(resolvePreset(preset('r20'), months)!.clamped).toBe(true)
  })

  it('직접 고르기: 끝이 시작 이하이면 마지막 달', () => {
    const months = range('200001', 60)
    expect(resolveCustom('200206', '200201', months)).toEqual({ start: '200206', end: months.at(-1), clamped: false })
    expect(resolveCustom('200206', '200301', months)).toEqual({ start: '200206', end: '200301', clamped: false })
  })

  it('시작이 끝과 같으면 한 달 앞당긴다', () => {
    const months = range('200001', 12)
    expect(resolveCustom('200012', '200012', months)).toEqual({ start: '200011', end: '200012', clamped: true })
  })

  it('달이 2개 미만이면 null', () => {
    expect(resolvePreset(preset('r5'), ['200001'])).toBeNull()
  })

  it('기간 글자', () => {
    expect(spanText(140)).toBe('11년 8개월')
    expect(spanText(120)).toBe('10년')
    expect(spanText(5)).toBe('5개월')
  })
})
